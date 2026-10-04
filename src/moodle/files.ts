import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { carregarConfig, exigirToken } from '../config';
import { log } from '../logger';

/** O token entra na URL aqui dentro e nunca sai numa resposta de tool (§12). */
function comToken(fileurl: string, token: string): string {
  return fileurl + (fileurl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

/** URL limpa, para exibicao. */
export function semQueryString(fileurl: string | null | undefined): string | null {
  if (!fileurl) return null;
  const i = fileurl.indexOf('?');
  return i >= 0 ? fileurl.slice(0, i) : fileurl;
}

export interface ArquivoBaixado {
  caminho: string;
  sha256: string;
  bytes: number;
  novo: boolean;
}

function extensaoDe(filename: string | null, mimetype: string | null): string {
  const ext = filename ? path.extname(filename).toLowerCase() : '';
  if (ext && ext.length <= 6) return ext;
  if (mimetype === 'application/pdf') return '.pdf';
  return '.bin';
}

/**
 * Baixa via fileurl+token. Guarda por sha256: professor trocar o PDF mantendo
 * o nome muda o sha e re-extrai o texto (§10).
 */
export async function baixarArquivo(
  fileurl: string,
  filename: string | null,
  mimetype: string | null,
  shaConhecido?: string | null
): Promise<ArquivoBaixado> {
  const cfg = carregarConfig();
  exigirToken(cfg);

  const ext = extensaoDe(filename, mimetype);
  if (shaConhecido) {
    const jaTem = path.join(cfg.cacheDir, 'files', `${shaConhecido}${ext}`);
    if (fs.existsSync(jaTem)) {
      return { caminho: jaTem, sha256: shaConhecido, bytes: fs.statSync(jaTem).size, novo: false };
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const resp = await fetch(comToken(fileurl, cfg.token), { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`download HTTP ${resp.status} (${semQueryString(fileurl)})`);
    const buf = Buffer.from(await resp.arrayBuffer());

    // Moodle devolve JSON de erro com HTTP 200 quando o token nao serve para o arquivo.
    if (buf.length < 4096 && buf.subarray(0, 1).toString() === '{') {
      const txt = buf.toString('utf8');
      if (txt.includes('error')) throw new Error(`download recusado pelo Moodle: ${txt.slice(0, 160)}`);
    }

    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const destino = path.join(cfg.cacheDir, 'files', `${sha}${ext}`);
    if (!fs.existsSync(destino)) fs.writeFileSync(destino, buf);
    log.debug(`baixado ${filename || fileurl} ${buf.length}B sha=${sha.slice(0, 12)}`);
    return { caminho: destino, sha256: sha, bytes: buf.length, novo: true };
  } finally {
    clearTimeout(timer);
  }
}

/** GET simples, sem token — catalogo publico de planos. */
export async function baixarPublico(url: string): Promise<{ corpo: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'moodle-mcp/1.0 (uso pessoal)' },
    });
    return { corpo: await resp.text(), status: resp.status };
  } finally {
    clearTimeout(timer);
  }
}

/** Baixa um arquivo publico (PDF fora do Moodle) para o cache. */
export async function baixarBinarioPublico(url: string, ext = '.pdf'): Promise<ArquivoBaixado> {
  const cfg = carregarConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`download HTTP ${resp.status} (${url})`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const destino = path.join(cfg.cacheDir, 'files', `${sha}${ext}`);
    if (!fs.existsSync(destino)) fs.writeFileSync(destino, buf);
    return { caminho: destino, sha256: sha, bytes: buf.length, novo: true };
  } finally {
    clearTimeout(timer);
  }
}

export function sha256Texto(texto: string): string {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}
