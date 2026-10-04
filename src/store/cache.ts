import { db } from './db';
import { log } from '../logger';

export const TTL = {
  cursos: 12 * 3600,
  contents: 3600,
  assigns: 3600,
  quizzes: 3600,
  submissao: 30 * 60,
  submissaoVencida: 6 * 3600,
  notas: 6 * 3600,
  avisos: 30 * 60,
  calendario: 3600,
  plano: 30 * 24 * 3600,
} as const;

export function cacheGet<T>(chave: string): T | null {
  const linha = db()
    .prepare('SELECT payload, expira_em FROM http_cache WHERE chave = ?')
    .get(chave) as { payload: string; expira_em: number } | undefined;
  if (!linha) return null;
  if (linha.expira_em < Math.floor(Date.now() / 1000)) return null;
  try {
    return JSON.parse(linha.payload) as T;
  } catch {
    return null;
  }
}

export function cacheSet(chave: string, valor: unknown, ttlSegundos: number): void {
  db()
    .prepare(
      'INSERT INTO http_cache (chave, payload, expira_em) VALUES (?, ?, ?) ' +
        'ON CONFLICT(chave) DO UPDATE SET payload = excluded.payload, expira_em = excluded.expira_em'
    )
    .run(chave, JSON.stringify(valor), Math.floor(Date.now() / 1000) + ttlSegundos);
}

export function cacheInvalidar(prefixo: string): number {
  const r = db().prepare('DELETE FROM http_cache WHERE chave LIKE ?').run(`${prefixo}%`);
  return r.changes;
}

export function limparExpirados(): void {
  db().prepare('DELETE FROM http_cache WHERE expira_em < ?').run(Math.floor(Date.now() / 1000));
}

/**
 * Memoiza uma chamada de rede. Nenhuma tool toca a rede se houver cache vivo.
 */
export async function comCache<T>(
  chave: string,
  ttlSegundos: number,
  refresh: boolean,
  produtor: () => Promise<T>
): Promise<T> {
  if (!refresh) {
    const hit = cacheGet<T>(chave);
    if (hit !== null) {
      log.debug(`cache hit ${chave}`);
      return hit;
    }
  }
  const valor = await produtor();
  cacheSet(chave, valor, ttlSegundos);
  return valor;
}
