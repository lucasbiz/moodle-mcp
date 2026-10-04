import * as fs from 'fs';
import * as path from 'path';
import { registrarSegredo } from './logger';

export interface Config {
  moodleUrl: string;
  token: string;
  semestre: string;
  semestreAuto: boolean;
  cacheDir: string;
  dbPath: string;
  catalogoUrl: string;
  raiz: string;
}

/** Raiz do projeto: dois niveis acima de dist/config.js (ou src/config.ts em dev). */
export function raizProjeto(): string {
  return path.resolve(__dirname, '..');
}

/** Parser minimo de .env — sem dependencia. */
function lerArquivoEnv(arquivo: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(arquivo)) return out;
  for (const bruta of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    const i = linha.indexOf('=');
    if (i < 1) continue;
    const chave = linha.slice(0, i).trim();
    let valor = linha.slice(i + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    out[chave] = valor;
  }
  return out;
}

/** jan-jul -> N1, ago-dez -> N2 */
export function inferirSemestre(d = new Date()): string {
  const ano = d.getFullYear();
  const mes = d.getMonth() + 1;
  return `${ano}${mes <= 7 ? 1 : 2}`;
}

export function caminhoEnv(): string {
  if (process.env.MOODLE_MCP_ENV) return path.resolve(process.env.MOODLE_MCP_ENV);
  return path.join(raizProjeto(), '.env');
}

let cache: Config | null = null;

export function carregarConfig(): Config {
  if (cache) return cache;

  const raiz = raizProjeto();
  const arq = lerArquivoEnv(caminhoEnv());
  // process.env vence o arquivo: o cliente MCP pode injetar via "env" na config.
  const ler = (k: string, padrao = ''): string => (process.env[k] ?? arq[k] ?? padrao).trim();

  const moodleUrl = (ler('MOODLE_URL', 'https://presencial.moodle.ufsc.br')).replace(/\/+$/, '');
  const token = ler('MOODLE_TOKEN');
  const semestreRaw = ler('SEMESTRE', 'auto').toLowerCase();
  const semestreAuto = semestreRaw === 'auto' || semestreRaw === '';
  const semestre = semestreAuto ? inferirSemestre() : semestreRaw;

  const resolver = (p: string) => (path.isAbsolute(p) ? p : path.join(raiz, p));

  registrarSegredo(token);

  cache = {
    moodleUrl,
    token,
    semestre,
    semestreAuto,
    cacheDir: resolver(ler('CACHE_DIR', './cache')),
    dbPath: resolver(ler('DB_PATH', './dados.db')),
    catalogoUrl: (ler('CATALOGO_URL', 'https://programas-planos.inf.ufsc.br')).replace(/\/+$/, ''),
    raiz,
  };

  fs.mkdirSync(path.join(cache.cacheDir, 'files'), { recursive: true });
  fs.mkdirSync(path.join(cache.cacheDir, 'text'), { recursive: true });

  return cache;
}

export function exigirToken(c: Config): void {
  if (!c.token) {
    throw new Error(
      `MOODLE_TOKEN ausente. Preencha ${caminhoEnv()} (veja .env.example) ` +
        `ou passe MOODLE_TOKEN pelo bloco "env" da configuracao do agente.`
    );
  }
}
