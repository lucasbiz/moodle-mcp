import { db, agora } from '../store/db';
import { Item } from '../moodle/conteudo';
import { baixarArquivo, baixarBinarioPublico, baixarPublico } from '../moodle/files';
import { extrairPdf, PdfSemTexto } from './pdf';
import { htmlParaTexto } from './html';
import { chamar } from '../moodle/client';
import { acharCurso } from '../moodle/cursos';
import { comCache, TTL } from '../store/cache';
import { log } from '../logger';

export class NaoLegivel extends Error {}

const CHARS_POR_PAGINA = 3500;

function paginarTexto(texto: string): string[] {
  const limpo = texto.trim();
  if (limpo.length <= CHARS_POR_PAGINA) return [limpo];
  const paginas: string[] = [];
  const linhas = limpo.split('\n');
  let atual = '';
  for (const l of linhas) {
    if (atual.length + l.length + 1 > CHARS_POR_PAGINA && atual) {
      paginas.push(atual.trim());
      atual = '';
    }
    atual += l + '\n';
  }
  if (atual.trim()) paginas.push(atual.trim());
  return paginas;
}

function indexar(item: Item, paginas: string[]): void {
  db().prepare('DELETE FROM textos_fts WHERE item_id = ?').run(item.id);
  const stmt = db().prepare('INSERT INTO textos_fts (item_id, codigo, pagina, texto) VALUES (?, ?, ?, ?)');
  const tx = db().transaction(() => {
    paginas.forEach((p, i) => {
      if (p.trim()) stmt.run(item.id, item.codigo, i + 1, p);
    });
  });
  tx();
}

async function textoDeAssign(item: Item): Promise<string[]> {
  const curso = await acharCurso(item.codigo);
  const resp = await comCache<{
    courses?: Array<{
      id: number;
      assignments?: Array<{
        cmid: number;
        name: string;
        intro?: string;
        introattachments?: Array<{ filename?: string; fileurl?: string; mimetype?: string }>;
      }>;
    }>;
  }>(`assigns:${curso.courseid}`, TTL.assigns, false, () =>
    chamar('mod_assign_get_assignments', { courseids: [curso.courseid] })
  );

  for (const c of resp.courses || []) {
    for (const a of c.assignments || []) {
      if (a.cmid !== item.cmid) continue;
      const paginas = paginarTexto(htmlParaTexto(a.intro));

      // O enunciado costuma estar no anexo, nao no intro ("veja o arquivo anexo").
      for (const anexo of a.introattachments || []) {
        if (!anexo.fileurl) continue;
        if (anexo.mimetype && anexo.mimetype !== 'application/pdf') {
          paginas.push(`[anexo nao extraido: ${anexo.filename} (${anexo.mimetype})]`);
          continue;
        }
        try {
          const arq = await baixarArquivo(anexo.fileurl, anexo.filename ?? null, anexo.mimetype ?? null, null);
          const doAnexo = await extrairPdf(arq.caminho, arq.sha256);
          paginas.push(`[anexo: ${anexo.filename}]`, ...doAnexo);
        } catch (e) {
          log.debug(`anexo ${anexo.filename} nao extraido`, e);
          paginas.push(`[anexo ilegivel: ${anexo.filename}]`);
        }
      }
      return paginas.length ? paginas : ['(tarefa sem enunciado escrito)'];
    }
  }
  throw new NaoLegivel(`enunciado de ${item.id} nao encontrado`);
}

async function textoDePagina(item: Item): Promise<string> {
  const curso = await acharCurso(item.codigo);
  const resp = await comCache<{ pages?: Array<{ coursemodule: number; content?: string; intro?: string }> }>(
    `pages:${curso.courseid}`,
    TTL.contents,
    false,
    () => chamar('mod_page_get_pages_by_courses', { courseids: [curso.courseid] })
  );
  for (const p of resp.pages || []) {
    if (p.coursemodule === item.cmid) return htmlParaTexto(p.content || p.intro || '');
  }
  throw new NaoLegivel(`pagina ${item.id} nao encontrada`);
}

export interface Leitura {
  paginas: string[];
  origem: string;
  unidade: 'pag.' | 'bloco';
}

/**
 * Le um item: PDF vira texto (pdftotext), link externo vira texto, enunciado de
 * tarefa vem do proprio Moodle. O texto extraido entra no indice FTS para buscar.
 */
export async function lerItem(item: Item & { sha256?: string | null }, refresh = false): Promise<Leitura> {
  // 1. arquivo no Moodle
  if (item.fileurl) {
    const arq = await baixarArquivo(item.fileurl, item.filename, item.mimetype, refresh ? null : item.sha256);
    db().prepare('UPDATE itens SET sha256 = ?, path_arquivo = ?, atualizado_em = ? WHERE id = ?')
      .run(arq.sha256, arq.caminho, agora(), item.id);

    if (item.mimetype && item.mimetype !== 'application/pdf') {
      throw new NaoLegivel(
        `${item.id} e ${item.mimetype}; so PDF e extraido nesta versao (arquivo em cache: ${arq.caminho})`
      );
    }
    const paginas = await extrairPdf(arq.caminho, arq.sha256);
    db().prepare('UPDATE itens SET paginas = ? WHERE id = ?').run(paginas.length, item.id);
    indexar(item, paginas);
    return { paginas, origem: item.filename || 'PDF', unidade: 'pag.' };
  }

  // 2. link externo
  if (item.url) {
    if (/\.pdf($|\?)/i.test(item.url)) {
      const arq = await baixarBinarioPublico(item.url);
      const paginas = await extrairPdf(arq.caminho, arq.sha256);
      indexar(item, paginas);
      return { paginas, origem: item.url, unidade: 'pag.' };
    }
    if (/youtube\.com|youtu\.be|canva\.|drive\.google/i.test(item.url)) {
      return { paginas: [`link externo sem texto extraivel: ${item.url}`], origem: item.url, unidade: 'bloco' };
    }
    const { corpo, status } = await baixarPublico(item.url);
    if (status !== 200) throw new NaoLegivel(`${item.url} respondeu HTTP ${status}`);
    const paginas = paginarTexto(htmlParaTexto(corpo));
    indexar(item, paginas);
    return { paginas, origem: item.url, unidade: 'bloco' };
  }

  // 3. conteudo que mora no proprio Moodle
  if (item.modname === 'assign') {
    const paginas = await textoDeAssign(item);
    indexar(item, paginas);
    return { paginas, origem: 'enunciado da tarefa', unidade: 'bloco' };
  }
  if (item.modname === 'page' || item.modname === 'book') {
    const paginas = paginarTexto(await textoDePagina(item));
    indexar(item, paginas);
    return { paginas, origem: 'pagina do Moodle', unidade: 'bloco' };
  }
  if (item.descricao) {
    const paginas = paginarTexto(item.descricao);
    indexar(item, paginas);
    return { paginas, origem: 'texto no Moodle', unidade: 'bloco' };
  }

  throw new NaoLegivel(`${item.id} (${item.tipo}) nao tem conteudo legivel`);
}

export { PdfSemTexto };
