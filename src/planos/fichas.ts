import { db, agora } from '../store/db';
import { acharCurso } from '../moodle/cursos';
import { semanaParaIntervalo } from '../agenda/semanas';
import { blocosDeTexto, hashDosBlocos, MapaSha } from '../moodle/textos';
import { log } from '../logger';

export interface Avaliacao {
  sigla: string;
  nome: string;
  peso: number | null;
  composicao?: string | null;
  data?: string | null;
  grupo?: boolean;
}

export interface Marco {
  semana?: number | null;
  data?: string | null;
  o_que: string;
}

export interface Ficha {
  codigo: string;
  professor?: string | null;
  horario?: string | null;
  formula?: string | null;
  pesos_conhecidos: boolean;
  avaliacoes: Avaliacao[];
  nao_vale_nota?: string[];
  recuperacao?: { regra?: string | null; data?: string | null } | null;
  frequencia?: string | null;
  cronograma?: { tipo: 'semanas' | 'datas'; marcos: Marco[] } | null;
  fonte?: string | null;
  fonte_sha?: string | null;
  extraido_em?: string | null;
}

export interface FichaSalva {
  ficha: Ficha;
  status: 'ok' | 'desatualizada';
  fonte: string | null;
  fonteSha: string | null;
  extraidoEm: string;
  textosSha: MapaSha | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export class FichaInvalida extends Error {}

function validar(ficha: Ficha, startdateEpoch: number | null): string[] {
  const erros: string[] = [];

  if (!Array.isArray(ficha.avaliacoes) || ficha.avaliacoes.length === 0) {
    erros.push('avaliacoes vazio: a ficha existe para dizer o que vale nota');
  }

  const siglas = new Set<string>();
  for (const a of ficha.avaliacoes || []) {
    if (!a.sigla || !a.sigla.trim()) erros.push('avaliacao sem sigla');
    else if (siglas.has(a.sigla)) erros.push(`sigla repetida: ${a.sigla}`);
    else siglas.add(a.sigla);
    if (!a.nome || !a.nome.trim()) erros.push(`avaliacao ${a.sigla} sem nome`);
    if (a.peso != null && (a.peso < 0 || a.peso > 1)) {
      erros.push(`peso de ${a.sigla} fora de 0..1 (use fracao: 0,60 e nao 60)`);
    }
    if (a.data && !ISO.test(a.data)) erros.push(`data de ${a.sigla} nao e ISO yyyy-mm-dd: "${a.data}"`);
  }

  if (ficha.pesos_conhecidos) {
    const faltando = (ficha.avaliacoes || []).filter((a) => a.peso == null);
    if (faltando.length) {
      erros.push(
        `pesos_conhecidos=true mas ${faltando.map((a) => a.sigla).join(', ')} sem peso ` +
          '(use pesos_conhecidos=false se o documento nao informa)'
      );
    } else {
      const soma = (ficha.avaliacoes || []).reduce((s, a) => s + (a.peso || 0), 0);
      if (Math.abs(soma - 1) > 0.02) {
        erros.push(`soma dos pesos = ${soma.toFixed(3)}, esperado 1,00 (tolerancia 0,02)`);
      }
    }
  }

  if (ficha.recuperacao?.data && !ISO.test(ficha.recuperacao.data)) {
    erros.push(`data de recuperacao nao e ISO: "${ficha.recuperacao.data}"`);
  }

  for (const m of ficha.cronograma?.marcos || []) {
    if (m.data && !ISO.test(m.data)) erros.push(`marco "${m.o_que}" com data nao-ISO: "${m.data}"`);
    if (m.semana != null && (m.semana < 1 || m.semana > 25)) {
      erros.push(`marco "${m.o_que}" com semana fora de 1..25`);
    }
  }

  if (startdateEpoch) {
    const inicio = new Date((startdateEpoch - 30 * 86400) * 1000).toISOString().slice(0, 10);
    const fim = new Date((startdateEpoch + 220 * 86400) * 1000).toISOString().slice(0, 10);
    const datas = [
      ...(ficha.avaliacoes || []).map((a) => [a.sigla, a.data] as const),
      ['recuperacao', ficha.recuperacao?.data] as const,
      ...(ficha.cronograma?.marcos || []).map((m) => [m.o_que, m.data] as const),
    ];
    for (const [rotulo, data] of datas) {
      if (data && ISO.test(data) && (data < inicio || data > fim)) {
        erros.push(`data de ${rotulo} (${data}) fora do semestre (${inicio} a ${fim})`);
      }
    }
  }

  return erros;
}

function normalizarTitulo(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Datas que so existem no documento-mestre viram prazos (fontes 4 e 5 da §9).
 * Quando a data muda em relacao a ficha anterior, a anterior entra em
 * quarentena em vez de sumir: as duas aparecem ate eu confirmar (§8.4).
 */
function regravarPrazos(codigo: string, ficha: Ficha, startdateEpoch: number | null): void {
  const anteriores = db()
    .prepare("SELECT id, data, sigla, titulo FROM prazos WHERE codigo = ? AND fonte IN ('ficha','cronograma')")
    .all(codigo) as Array<{ id: string; data: string | null; sigla: string | null; titulo: string }>;

  const porChave = new Map<string, { data: string | null }>();
  for (const p of anteriores) {
    porChave.set(p.sigla || normalizarTitulo(p.titulo), { data: p.data });
  }

  db().prepare("DELETE FROM prazos WHERE codigo = ? AND fonte IN ('ficha','cronograma')").run(codigo);

  const inserir = db().prepare(
    `INSERT INTO prazos (id, codigo, titulo, tipo, data, fonte, peso, sigla, status, confianca,
        quarentena, data_anterior, atualizado_em)
     VALUES (@id, @codigo, @titulo, @tipo, @data, @fonte, @peso, @sigla, NULL, @confianca,
        @quarentena, @data_anterior, @atualizado_em)`
  );

  let n = 0;
  const gravar = (
    titulo: string,
    tipo: string,
    data: string | null,
    fonte: 'ficha' | 'cronograma',
    peso: number | null,
    sigla: string | null,
    confianca: 'exata' | 'estimada'
  ) => {
    if (!data) return;
    const chave = sigla || normalizarTitulo(titulo);
    const antes = porChave.get(chave);
    const mudou = antes && antes.data && antes.data !== data;
    inserir.run({
      id: `${codigo}:${fonte}:${chave}:${n++}`,
      codigo,
      titulo,
      tipo,
      data,
      fonte,
      peso,
      sigla,
      confianca,
      quarentena: mudou ? 1 : 0,
      data_anterior: mudou ? antes!.data : null,
      atualizado_em: agora(),
    });
  };

  for (const a of ficha.avaliacoes || []) {
    const tipo = /prova|exame/i.test(a.nome) ? 'prova' : 'trabalho';
    gravar(a.nome, tipo, a.data || null, 'ficha', a.peso ?? null, a.sigla, 'exata');
  }
  if (ficha.recuperacao?.data) {
    gravar('Recuperacao', 'prova', ficha.recuperacao.data, 'ficha', null, 'REC', 'exata');
  }

  for (const m of ficha.cronograma?.marcos || []) {
    if (m.data) {
      gravar(m.o_que, 'outro', m.data, 'cronograma', null, null, 'exata');
    } else if (m.semana != null && startdateEpoch) {
      const { centro } = semanaParaIntervalo(startdateEpoch, m.semana);
      gravar(`${m.o_que} (semana ${m.semana})`, 'outro', centro, 'cronograma', null, null, 'estimada');
    }
  }
  log.debug(`${codigo}: ${n} prazos derivados da ficha`);
}

export async function salvarFicha(
  codigo: string,
  ficha: Ficha,
  fonteExplicita?: { fonte?: string; fonte_sha?: string }
): Promise<{ erros: string[]; prazos: number }> {
  const curso = await acharCurso(codigo);
  ficha.codigo = curso.codigo;

  const erros = validar(ficha, curso.startdate);
  if (erros.length) throw new FichaInvalida(erros.join('; '));

  const plano = db().prepare('SELECT url, sha FROM planos_cache WHERE codigo = ?').get(curso.codigo) as
    | { url: string; sha: string }
    | undefined;

  const fonte = fonteExplicita?.fonte ?? ficha.fonte ?? plano?.url ?? null;
  const fonteSha = fonteExplicita?.fonte_sha ?? ficha.fonte_sha ?? plano?.sha ?? null;
  const extraidoEm = new Date().toISOString().slice(0, 10);

  const completa: Ficha = { ...ficha, fonte, fonte_sha: fonteSha, extraido_em: extraidoEm };

  // fotografa os quadros de texto do professor: a agenda vigia por hash depois
  let textosSha: string | null = null;
  try {
    textosSha = JSON.stringify(hashDosBlocos(await blocosDeTexto(curso.codigo)));
  } catch (e) {
    log.debug(`${curso.codigo}: quadros de texto nao fotografados`, e);
  }

  db()
    .prepare(
      `INSERT INTO fichas (codigo, semestre, json, fonte, fonte_sha, extraido_em, status, textos_sha)
       VALUES (?, ?, ?, ?, ?, ?, 'ok', ?)
       ON CONFLICT(codigo) DO UPDATE SET
         semestre = excluded.semestre, json = excluded.json, fonte = excluded.fonte,
         fonte_sha = excluded.fonte_sha, extraido_em = excluded.extraido_em, status = 'ok',
         textos_sha = excluded.textos_sha`
    )
    .run(curso.codigo, curso.semestre, JSON.stringify(completa), fonte, fonteSha, extraidoEm, textosSha);

  regravarPrazos(curso.codigo, completa, curso.startdate);

  const prazos = db()
    .prepare("SELECT COUNT(*) AS n FROM prazos WHERE codigo = ? AND fonte IN ('ficha','cronograma')")
    .get(curso.codigo) as { n: number };

  return { erros: [], prazos: prazos.n };
}

export function lerFicha(codigo: string): FichaSalva | null {
  const r = db().prepare('SELECT * FROM fichas WHERE codigo = ?').get(codigo.toUpperCase()) as
    | {
        json: string; status: 'ok' | 'desatualizada'; fonte: string | null;
        fonte_sha: string | null; extraido_em: string; textos_sha: string | null;
      }
    | undefined;
  if (!r) return null;
  try {
    let textosSha: MapaSha | null = null;
    if (r.textos_sha) {
      try {
        textosSha = JSON.parse(r.textos_sha) as MapaSha;
      } catch {
        textosSha = null;
      }
    }
    return {
      ficha: JSON.parse(r.json) as Ficha,
      status: r.status,
      fonte: r.fonte,
      fonteSha: r.fonte_sha,
      extraidoEm: r.extraido_em,
      textosSha,
    };
  } catch {
    return null;
  }
}

export function fichasSalvas(): Map<string, FichaSalva> {
  const out = new Map<string, FichaSalva>();
  const linhas = db().prepare('SELECT codigo FROM fichas').all() as Array<{ codigo: string }>;
  for (const l of linhas) {
    const f = lerFicha(l.codigo);
    if (f) out.set(l.codigo, f);
  }
  return out;
}
