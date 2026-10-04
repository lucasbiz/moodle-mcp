import { carregarConfig, exigirToken } from '../config';
import { log, redigir } from '../logger';
import { verificarPermitida } from './allowlist';

export class MoodleErro extends Error {
  constructor(
    message: string,
    readonly codigo?: string,
    readonly funcao?: string
  ) {
    super(message);
    this.name = 'MoodleErro';
  }
}

const TIMEOUT_MS = 30_000;
const TENTATIVAS = 3;

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Achata params aninhados no formato que o Moodle espera: a[0][b]=c */
function achatar(params: Record<string, unknown>, prefixo = ''): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const chave = prefixo ? `${prefixo}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          out.push(...achatar(item as Record<string, unknown>, `${chave}[${i}]`));
        } else {
          out.push([`${chave}[${i}]`, String(item)]);
        }
      });
    } else if (typeof v === 'object') {
      out.push(...achatar(v as Record<string, unknown>, chave));
    } else if (typeof v === 'boolean') {
      out.push([chave, v ? '1' : '0']);
    } else {
      out.push([chave, String(v)]);
    }
  }
  return out;
}

/**
 * Chamada crua ao web service REST. Sem cache — quem cacheia e o store.
 */
export async function chamar<T = unknown>(
  funcao: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  verificarPermitida(funcao);
  const cfg = carregarConfig();
  exigirToken(cfg);

  const url = `${cfg.moodleUrl}/webservice/rest/server.php`;
  const corpo = new URLSearchParams();
  corpo.set('wstoken', cfg.token);
  corpo.set('wsfunction', funcao);
  corpo.set('moodlewsrestformat', 'json');
  for (const [k, v] of achatar(params)) corpo.append(k, v);

  let ultimoErro: Error | null = null;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const inicio = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpo,
        signal: ctrl.signal,
      });

      if (resp.status === 429 || resp.status >= 500) {
        const retryAfter = Number(resp.headers.get('retry-after'));
        const espera = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(8000, 500 * 2 ** (tentativa - 1));
        ultimoErro = new MoodleErro(`HTTP ${resp.status} em ${funcao}`, String(resp.status), funcao);
        if (tentativa < TENTATIVAS) {
          log.warn(`${funcao}: HTTP ${resp.status}, retentando em ${espera}ms`);
          await dormir(espera);
          continue;
        }
        throw ultimoErro;
      }

      if (!resp.ok) {
        throw new MoodleErro(`HTTP ${resp.status} em ${funcao}`, String(resp.status), funcao);
      }

      const texto = await resp.text();
      log.debug(`${funcao} ${Date.now() - inicio}ms ${texto.length}B`);

      let dados: unknown;
      try {
        dados = JSON.parse(texto);
      } catch {
        throw new MoodleErro(
          `resposta nao-JSON em ${funcao}: ${redigir(texto.slice(0, 200))}`,
          'parse',
          funcao
        );
      }

      if (dados && typeof dados === 'object' && 'exception' in (dados as object)) {
        const e = dados as { errorcode?: string; message?: string; exception?: string };
        throw new MoodleErro(
          `${funcao}: ${redigir(e.message || e.exception || 'erro do Moodle')}`,
          e.errorcode,
          funcao
        );
      }

      return dados as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof MoodleErro && err.codigo !== undefined && !/^5\d\d$|^429$/.test(err.codigo)) {
        throw err; // erro de negocio: nao adianta retentar
      }
      ultimoErro = err as Error;
      if (tentativa < TENTATIVAS) {
        const espera = Math.min(8000, 500 * 2 ** (tentativa - 1));
        log.warn(`${funcao}: ${redigir(String((err as Error).message))}, retentando em ${espera}ms`);
        await dormir(espera);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw ultimoErro ?? new MoodleErro(`falha em ${funcao}`, undefined, funcao);
}

/** Limita concorrencia — usado nas rajadas de submission_status. */
export async function emLotes<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const idx = i++;
      out[idx] = await fn(itens[idx]);
    }
  });
  await Promise.all(trabalhadores);
  return out;
}
