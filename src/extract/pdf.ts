import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { carregarConfig } from '../config';

const exec = promisify(execFile);

let disponivel: boolean | null = null;

export async function pdftotextDisponivel(): Promise<boolean> {
  if (disponivel !== null) return disponivel;
  try {
    await exec('pdftotext', ['-v']);
    disponivel = true;
  } catch {
    disponivel = false;
  }
  return disponivel;
}

export class PdfSemTexto extends Error {}

/**
 * pdftotext -layout preserva tabela de cronograma, que e justamente o que
 * interessa nos planos. Paginas vem separadas por \f.
 */
export async function extrairPdf(caminhoArquivo: string, sha: string): Promise<string[]> {
  const cfg = carregarConfig();
  const cacheTxt = path.join(cfg.cacheDir, 'text', `${sha}.txt`);

  let bruto: string;
  if (fs.existsSync(cacheTxt)) {
    bruto = fs.readFileSync(cacheTxt, 'utf8');
  } else {
    if (!(await pdftotextDisponivel())) {
      throw new Error('pdftotext nao encontrado. Instale com: sudo apt install poppler-utils');
    }
    try {
      const { stdout } = await exec('pdftotext', ['-layout', '-enc', 'UTF-8', caminhoArquivo, '-'], {
        maxBuffer: 64 * 1024 * 1024,
      });
      bruto = stdout;
    } catch (e) {
      throw new Error(`pdftotext falhou em ${path.basename(caminhoArquivo)}: ${(e as Error).message}`);
    }
    fs.writeFileSync(cacheTxt, bruto, 'utf8');
  }

  const paginas = bruto.split('\f').map((p) => p.replace(/[ \t]+$/gm, '').trim());
  while (paginas.length > 1 && paginas[paginas.length - 1] === '') paginas.pop();

  const util = paginas.join('').replace(/\s/g, '');
  if (util.length < 40) {
    throw new PdfSemTexto(
      'PDF sem camada de texto (provavelmente digitalizado). OCR esta fora do escopo.'
    );
  }

  return paginas;
}

export function textoDePaginas(paginas: string[]): string {
  return paginas.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
