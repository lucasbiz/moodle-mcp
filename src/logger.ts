/**
 * Log sempre em stderr: stdout e o canal do transporte MCP.
 * Token e redigido em qualquer string que passe por aqui.
 */

let segredos: string[] = [];

export function registrarSegredo(valor: string | undefined): void {
  if (valor && valor.length >= 8 && !segredos.includes(valor)) segredos.push(valor);
}

export function redigir(texto: string): string {
  let out = texto;
  for (const s of segredos) out = out.split(s).join('***');
  // token em query string, mesmo que nao seja o nosso
  out = out.replace(/([?&](?:wstoken|token)=)[^&\s]+/gi, '$1***');
  return out;
}

const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Nivel = keyof typeof NIVEIS;

function nivelAtual(): number {
  const n = (process.env.LOG_LEVEL || 'info').toLowerCase() as Nivel;
  return NIVEIS[n] ?? NIVEIS.info;
}

function escrever(nivel: Nivel, msg: string, extra?: unknown): void {
  if (NIVEIS[nivel] < nivelAtual()) return;
  const ts = new Date().toISOString();
  let linha = `${ts} ${nivel.toUpperCase()} ${msg}`;
  if (extra !== undefined) {
    const s = extra instanceof Error ? (extra.stack || extra.message) : JSON.stringify(extra);
    linha += ` ${s}`;
  }
  process.stderr.write(redigir(linha) + '\n');
}

export const log = {
  debug: (m: string, e?: unknown) => escrever('debug', m, e),
  info: (m: string, e?: unknown) => escrever('info', m, e),
  warn: (m: string, e?: unknown) => escrever('warn', m, e),
  error: (m: string, e?: unknown) => escrever('error', m, e),
};
