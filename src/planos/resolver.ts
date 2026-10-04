import { db, agora } from '../store/db';
import { acharCurso } from '../moodle/cursos';
import { sincronizarItens, Item } from '../moodle/conteudo';
import { baixarArquivo, baixarBinarioPublico, baixarPublico, sha256Texto } from '../moodle/files';
import { extrairPdf, textoDePaginas } from '../extract/pdf';
import { htmlParaTexto, normalizarParaHash } from '../extract/html';
import { seccionar, Seccionamento, Secao, SecaoCanonica } from './secoes';
import { buscarPlanoCatalogo, PlanoInexistente, ehUrlDoCatalogo, urlDerivada } from './catalogo';
import { log } from '../logger';

export class DocumentoAusente extends Error {}

export type Origem = 'catalogo' | 'pdf_moodle' | 'pdf_externo' | 'html_externo';

export interface DiffSecao {
  rotulo: string;
  canonica: SecaoCanonica | null;
  removidas: string[];
  adicionadas: string[];
}

export interface Mudanca {
  shaAnterior: string;
  vistoEm: string;
  secoes: DiffSecao[];
  critica: boolean;
}

export interface Documento {
  codigo: string;
  origem: Origem;
  url: string;
  titulo: string;
  texto: string;
  seccionamento: Seccionamento;
  sha: string;
  buscadoEm: string;
  revalidadoEm: string | null;
  mudanca: Mudanca | null;
  doCache: boolean;
}

const SECOES_CRITICAS: SecaoCanonica[] = ['avaliacao', 'recuperacao', 'cronograma'];
const REVALIDA_APOS_MS = 12 * 3600 * 1000;

/** Precedencia: plano de ensino > programa > ementa > cronograma (§8, via 1). */
const PADROES: Array<[RegExp, number]> = [
  [/plano\s+de\s+ensino|syllabus/i, 0],
  [/programa\s+da\s+disciplina/i, 1],
  [/\bementa\b/i, 2],
  [/cronograma|calend[aá]rio\s+(da\s+)?(disciplina|semestre)/i, 3],
];

function pontuar(nome: string): number | null {
  for (const [re, peso] of PADROES) if (re.test(nome)) return peso;
  return null;
}

function acharModuloMestre(itens: Item[]): Item | null {
  let melhor: { item: Item; peso: number } | null = null;
  for (const item of itens) {
    if (!['url', 'resource'].includes(item.modname || '')) continue;
    const peso = pontuar(item.nome);
    if (peso === null) continue;
    if (item.modname === 'resource' && item.mimetype && item.mimetype !== 'application/pdf') continue;
    if (!melhor || peso < melhor.peso) melhor = { item, peso };
  }
  return melhor?.item ?? null;
}

async function textoDoItem(item: Item): Promise<{ origem: Origem; url: string; titulo: string; texto: string }> {
  if (item.modname === 'resource' && item.fileurl) {
    const arq = await baixarArquivo(item.fileurl, item.filename, item.mimetype, null);
    db().prepare('UPDATE itens SET sha256 = ?, path_arquivo = ? WHERE id = ?')
      .run(arq.sha256, arq.caminho, item.id);
    const paginas = await extrairPdf(arq.caminho, arq.sha256);
    return {
      origem: 'pdf_moodle',
      url: item.fileurl.split('?')[0],
      titulo: item.nome,
      texto: textoDePaginas(paginas),
    };
  }

  const alvo = item.url || '';
  if (!alvo) throw new DocumentoAusente(`modulo "${item.nome}" sem URL utilizavel`);

  if (ehUrlDoCatalogo(alvo)) {
    const pag = await buscarPlanoCatalogo(alvo);
    return { origem: 'catalogo', url: pag.url, titulo: pag.titulo, texto: pag.texto };
  }

  if (/\.pdf($|\?)/i.test(alvo)) {
    const arq = await baixarBinarioPublico(alvo);
    const paginas = await extrairPdf(arq.caminho, arq.sha256);
    return { origem: 'pdf_externo', url: alvo, titulo: item.nome, texto: textoDePaginas(paginas) };
  }

  const { corpo, status } = await baixarPublico(alvo);
  if (status !== 200) throw new DocumentoAusente(`"${item.nome}" respondeu HTTP ${status}`);
  return { origem: 'html_externo', url: alvo, titulo: item.nome, texto: htmlParaTexto(corpo) };
}

function diffLinhas(antes: string, depois: string): { removidas: string[]; adicionadas: string[] } {
  const a = new Set(antes.split('\n').map((l) => l.trim()).filter(Boolean));
  const d = new Set(depois.split('\n').map((l) => l.trim()).filter(Boolean));
  return {
    removidas: [...a].filter((l) => !d.has(l)),
    adicionadas: [...d].filter((l) => !a.has(l)),
  };
}

function compararSeccionamentos(antes: Seccionamento, depois: Seccionamento): DiffSecao[] {
  const chave = (s: Secao) => s.canonica || s.rotulo.toLowerCase();
  const mapaA = new Map(antes.secoes.map((s) => [chave(s), s]));
  const mapaD = new Map(depois.secoes.map((s) => [chave(s), s]));
  const todas = new Set([...mapaA.keys(), ...mapaD.keys()]);

  const out: DiffSecao[] = [];
  for (const k of todas) {
    const a = mapaA.get(k);
    const d = mapaD.get(k);
    const textoA = normalizarParaHash(a?.texto || '');
    const textoD = normalizarParaHash(d?.texto || '');
    if (textoA === textoD) continue;
    const { removidas, adicionadas } = diffLinhas(textoA, textoD);
    out.push({
      rotulo: d?.rotulo || a?.rotulo || k,
      canonica: (d?.canonica ?? a?.canonica) || null,
      removidas,
      adicionadas,
    });
  }
  return out;
}

interface LinhaCache {
  codigo: string;
  semestre: string | null;
  origem: Origem;
  url: string;
  titulo: string;
  texto: string;
  secoes_json: string;
  sha: string;
  buscado_em: string;
  revalidado_em: string | null;
}

function lerCache(codigo: string): LinhaCache | null {
  return (db().prepare('SELECT * FROM planos_cache WHERE codigo = ?').get(codigo) as LinhaCache) || null;
}

function gravarVersao(codigo: string, sha: string, texto: string, secoesJson: string): void {
  db()
    .prepare(
      'INSERT OR IGNORE INTO planos_versoes (codigo, sha, texto, secoes_json, visto_em) VALUES (?, ?, ?, ?, ?)'
    )
    .run(codigo, sha, texto, secoesJson, agora());
}

function marcarFichaDesatualizada(codigo: string): void {
  db().prepare("UPDATE fichas SET status = 'desatualizada' WHERE codigo = ?").run(codigo);
}

/**
 * Resolve e revalida o documento-mestre da disciplina.
 * `revalidar` baixa de novo e compara hash: ~20 KB, ~200 ms, zero token —
 * um cache de 30 dias esconderia prova remarcada no meio do semestre (§8.4).
 */
export async function resolverDocumento(
  codigo: string,
  opcoes: { refresh?: boolean; revalidar?: boolean } = {}
): Promise<Documento> {
  const curso = await acharCurso(codigo);
  const cache = lerCache(curso.codigo);
  const refresh = opcoes.refresh === true;

  let precisaBuscar = refresh || !cache;
  if (!precisaBuscar && cache) {
    const idade = Date.now() - new Date(cache.revalidado_em || cache.buscado_em).getTime();
    if (opcoes.revalidar && idade > 0) precisaBuscar = true;
    if (idade > REVALIDA_APOS_MS) precisaBuscar = true;
  }

  if (!precisaBuscar && cache) {
    return {
      codigo: curso.codigo,
      origem: cache.origem,
      url: cache.url,
      titulo: cache.titulo,
      texto: cache.texto,
      seccionamento: JSON.parse(cache.secoes_json) as Seccionamento,
      sha: cache.sha,
      buscadoEm: cache.buscado_em,
      revalidadoEm: cache.revalidado_em,
      mudanca: null,
      doCache: true,
    };
  }

  let bruto: { origem: Origem; url: string; titulo: string; texto: string };
  try {
    bruto = await buscarDocumento(curso.codigo, curso.turma, curso.semestre, refresh);
  } catch (e) {
    if (cache) {
      log.warn(`revalidacao de ${curso.codigo} falhou, respondendo do cache`, e);
      return {
        codigo: curso.codigo,
        origem: cache.origem,
        url: cache.url,
        titulo: cache.titulo,
        texto: cache.texto,
        seccionamento: JSON.parse(cache.secoes_json) as Seccionamento,
        sha: cache.sha,
        buscadoEm: cache.buscado_em,
        revalidadoEm: cache.revalidado_em,
        mudanca: null,
        doCache: true,
      };
    }
    throw e;
  }

  const normalizado = normalizarParaHash(bruto.texto);
  const sha = sha256Texto(normalizado);
  const seccionamento = seccionar(bruto.texto);
  const secoesJson = JSON.stringify(seccionamento);

  let mudanca: Mudanca | null = null;
  if (cache && cache.sha !== sha) {
    const anterior = JSON.parse(cache.secoes_json) as Seccionamento;
    const secoes = compararSeccionamentos(anterior, seccionamento);
    const critica = secoes.some((s) => s.canonica && SECOES_CRITICAS.includes(s.canonica));
    mudanca = { shaAnterior: cache.sha, vistoEm: agora(), secoes, critica };
    gravarVersao(curso.codigo, cache.sha, cache.texto, cache.secoes_json);
    if (critica) marcarFichaDesatualizada(curso.codigo);
    log.info(`documento-mestre de ${curso.codigo} mudou (${secoes.length} secoes, critica=${critica})`);
    db().prepare('INSERT OR REPLACE INTO meta (chave, valor) VALUES (?, ?)')
      .run(`mudanca:${curso.codigo}`, JSON.stringify(mudanca));
  }

  db()
    .prepare(
      `INSERT INTO planos_cache (codigo, semestre, origem, url, titulo, texto, secoes_json, sha, buscado_em, revalidado_em)
       VALUES (@codigo, @semestre, @origem, @url, @titulo, @texto, @secoes_json, @sha, @buscado_em, @revalidado_em)
       ON CONFLICT(codigo) DO UPDATE SET
         semestre = excluded.semestre, origem = excluded.origem, url = excluded.url,
         titulo = excluded.titulo, texto = excluded.texto, secoes_json = excluded.secoes_json,
         sha = excluded.sha, revalidado_em = excluded.revalidado_em,
         buscado_em = CASE WHEN planos_cache.sha = excluded.sha THEN planos_cache.buscado_em ELSE excluded.buscado_em END`
    )
    .run({
      codigo: curso.codigo,
      semestre: curso.semestre,
      origem: bruto.origem,
      url: bruto.url,
      titulo: bruto.titulo,
      texto: bruto.texto,
      secoes_json: secoesJson,
      sha,
      buscado_em: agora(),
      revalidado_em: agora(),
    });
  gravarVersao(curso.codigo, sha, bruto.texto, secoesJson);

  return {
    codigo: curso.codigo,
    origem: bruto.origem,
    url: bruto.url,
    titulo: bruto.titulo,
    texto: bruto.texto,
    seccionamento,
    sha,
    buscadoEm: agora(),
    revalidadoEm: agora(),
    mudanca,
    doCache: false,
  };
}

/** Via 1 (modulo no Moodle) -> via 2 (URL derivada) -> via 3 (ausente). */
async function buscarDocumento(
  codigo: string,
  turma: string,
  semestre: string,
  refresh: boolean
): Promise<{ origem: Origem; url: string; titulo: string; texto: string }> {
  const itens = await sincronizarItens(codigo, refresh);
  const modulo = acharModuloMestre(itens);

  if (modulo) {
    try {
      return await textoDoItem(modulo);
    } catch (e) {
      log.warn(`via 1 falhou para ${codigo} (modulo "${modulo.nome}")`, e);
    }
  }

  try {
    const url = urlDerivada(codigo, turma, semestre);
    const pag = await buscarPlanoCatalogo(url);
    return { origem: 'catalogo', url: pag.url, titulo: pag.titulo, texto: pag.texto };
  } catch (e) {
    if (!(e instanceof PlanoInexistente)) log.warn(`via 2 falhou para ${codigo}`, e);
  }

  throw new DocumentoAusente(
    `documento-mestre nao encontrado para ${codigo} (sem plano/cronograma no Moodle e fora do catalogo do INE)`
  );
}

export function ultimaMudanca(codigo: string): Mudanca | null {
  const r = db().prepare('SELECT valor FROM meta WHERE chave = ?').get(`mudanca:${codigo}`) as
    | { valor: string }
    | undefined;
  return r ? (JSON.parse(r.valor) as Mudanca) : null;
}
