import { chamar } from './client';
import { comCache, TTL } from '../store/cache';
import { db, agora } from '../store/db';
import { htmlParaLinha, htmlParaTexto } from '../extract/html';
import { acharCurso, Curso } from './cursos';

export interface Item {
  id: string;
  codigo: string;
  chave: string;
  cmid: number | null;
  idx: number;
  nome: string;
  tipo: string;
  secao: string | null;
  modname: string | null;
  url: string | null;
  fileurl: string | null;
  filename: string | null;
  mimetype: string | null;
  filesize: number | null;
  timemodified: number | null;
  descricao: string | null;
}

export interface Secao {
  nome: string;
  resumo: string;
  modulos: ModuloWS[];
}

export interface ConteudoWS {
  id: number;
  name: string;
  summary?: string;
  modules?: ModuloWS[];
}

export interface ModuloWS {
  id: number;
  name: string;
  modname: string;
  url?: string;
  description?: string;
  uservisible?: boolean;
  dates?: Array<{ label: string; timestamp: number }>;
  contents?: Array<{
    type: string;
    filename?: string;
    filesize?: number;
    mimetype?: string;
    timemodified?: number;
    fileurl?: string;
  }>;
}

const TIPOS: Record<string, string> = {
  url: 'link',
  page: 'pagina',
  folder: 'pasta',
  assign: 'tarefa',
  quiz: 'quiz',
  forum: 'forum',
  label: 'texto',
  book: 'pagina',
};

function tipoDoModulo(m: ModuloWS): string {
  if (m.modname === 'resource') {
    const mt = m.contents?.[0]?.mimetype || '';
    if (mt === 'application/pdf') return 'pdf';
    if (/presentation|powerpoint/.test(mt)) return 'slides';
    if (/word|document/.test(mt)) return 'doc';
    return 'arquivo';
  }
  return TIPOS[m.modname] ?? m.modname;
}

export async function conteudoBruto(curso: Curso, refresh = false): Promise<ConteudoWS[]> {
  return comCache<ConteudoWS[]>(`contents:${curso.courseid}`, TTL.contents, refresh, () =>
    chamar<ConteudoWS[]>('core_course_get_contents', { courseid: curso.courseid })
  );
}

/**
 * Sincroniza os itens da disciplina. `idx` e sequencial e ESTAVEL: uma vez
 * atribuido a um cmid, nao muda se o professor reordenar a pagina (§5.3).
 */
/**
 * Sincroniza os itens da disciplina. `idx` e sequencial e ESTAVEL: uma vez
 * atribuido a uma chave, nao muda se o professor reordenar a pagina (§5.3).
 */
export async function sincronizarItens(codigo: string, refresh = false): Promise<Item[]> {
  const curso = await acharCurso(codigo, refresh);
  const secoes = await conteudoBruto(curso, refresh);

  const existentes = db()
    .prepare('SELECT chave, idx FROM itens WHERE codigo = ?')
    .all(curso.codigo) as Array<{ chave: string; idx: number }>;
  const porChave = new Map(existentes.map((e) => [e.chave, e.idx]));
  let proximo = existentes.reduce((max, e) => Math.max(max, e.idx), 0) + 1;

  const itens: Item[] = [];
  const registrar = (chave: string, base: Omit<Item, 'id' | 'idx' | 'chave' | 'codigo'>) => {
    const idx = porChave.get(chave) ?? proximo++;
    porChave.set(chave, idx);
    itens.push({ ...base, id: `${curso.codigo}/${idx}`, codigo: curso.codigo, chave, idx });
  };

  for (const s of secoes) {
    const nomeSecao = htmlParaLinha(s.name) || null;
    for (const m of s.modules || []) {
      if (m.uservisible === false) continue;
      const arquivos = (m.contents || []).filter((c) => c.type === 'file');
      const descricao = htmlParaTexto(m.description) || null;

      // Pasta: cada arquivo vira item proprio, senao PDF em pasta fica inalcancavel pelo `ler`.
      if (m.modname === 'folder' && arquivos.length > 0) {
        for (const c of arquivos) {
          registrar(`${m.id}#${c.filename}`, {
            cmid: m.id,
            nome: `${htmlParaLinha(m.name)} / ${c.filename || 'arquivo'}`,
            tipo: c.mimetype === 'application/pdf' ? 'pdf' : 'arquivo',
            secao: nomeSecao,
            modname: m.modname,
            url: null,
            fileurl: c.fileurl ?? null,
            filename: c.filename ?? null,
            mimetype: c.mimetype ?? null,
            filesize: c.filesize ?? null,
            timemodified: c.timemodified ?? null,
            descricao: null,
          });
        }
        continue;
      }

      const c0 = arquivos[0] ?? m.contents?.[0];
      const ehArquivo = c0?.type === 'file';
      registrar(String(m.id), {
        cmid: m.id,
        nome: htmlParaLinha(m.name) || `(${m.modname})`,
        tipo: tipoDoModulo(m),
        secao: nomeSecao,
        modname: m.modname,
        url: !ehArquivo && c0?.fileurl ? c0.fileurl : null,
        fileurl: ehArquivo ? c0?.fileurl ?? null : null,
        filename: ehArquivo ? c0?.filename ?? null : null,
        mimetype: ehArquivo ? c0?.mimetype ?? null : null,
        filesize: ehArquivo ? c0?.filesize ?? null : null,
        timemodified: c0?.timemodified ?? null,
        descricao,
      });
    }
  }

  const stmt = db().prepare(
    `INSERT INTO itens (id, codigo, chave, cmid, idx, nome, tipo, secao, modname, url, fileurl,
        filename, mimetype, filesize, timemodified, descricao, atualizado_em)
     VALUES (@id, @codigo, @chave, @cmid, @idx, @nome, @tipo, @secao, @modname, @url, @fileurl,
        @filename, @mimetype, @filesize, @timemodified, @descricao, @atualizado_em)
     ON CONFLICT(id) DO UPDATE SET
       chave = excluded.chave, cmid = excluded.cmid, nome = excluded.nome, tipo = excluded.tipo,
       secao = excluded.secao, modname = excluded.modname, url = excluded.url,
       fileurl = excluded.fileurl, filename = excluded.filename, mimetype = excluded.mimetype,
       filesize = excluded.filesize, timemodified = excluded.timemodified,
       descricao = excluded.descricao, atualizado_em = excluded.atualizado_em`
  );
  const tx = db().transaction((lista: Item[]) => {
    for (const i of lista) stmt.run({ ...i, atualizado_em: agora() });
  });
  tx(itens);

  return itens;
}

/** Resolve "INE5633/3" (ou "ine5633/3") para o item salvo. */
export async function acharItem(id: string): Promise<Item> {
  const bruto = id.trim();
  const m = bruto.match(/^([A-Za-z]{3}\d{4})\s*[\/#-]\s*(\d+)$/);
  if (!m) {
    throw new Error(`id invalido: "${id}". Formato esperado: INE5633/3 (veja materiais).`);
  }
  const codigo = m[1].toUpperCase();
  const alvo = `${codigo}/${Number(m[2])}`;

  let linha = db().prepare('SELECT * FROM itens WHERE id = ?').get(alvo) as any;
  if (!linha) {
    await sincronizarItens(codigo);
    linha = db().prepare('SELECT * FROM itens WHERE id = ?').get(alvo);
  }
  if (!linha) throw new Error(`item ${alvo} nao existe (use materiais("${codigo}"))`);
  return linha as Item;
}

export function itensSalvos(codigo: string): Item[] {
  return db()
    .prepare('SELECT * FROM itens WHERE codigo = ? ORDER BY idx')
    .all(codigo.toUpperCase()) as unknown as Item[];
}
