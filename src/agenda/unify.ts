import { db } from '../store/db';
import { Curso, resolverCursos } from '../moodle/cursos';
import { assignsDe, quizzesDe, eventosCalendario, statusSubmissoes } from '../moodle/prazos';
import { statusQuizzesNaJanela } from '../moodle/entregas';
import { conteudoBruto } from '../moodle/conteudo';
import { fichasSalvas, FichaSalva } from '../planos/fichas';
import { blocosDeTexto, hashDosBlocos, blocosNovosOuAlterados } from '../moodle/textos';
import { resolverDocumento } from '../planos/resolver';
import { epochParaISO, dataEmNomeDeSecao, hojeISO, somarDias, diffDias, ddmm } from './semanas';
import { htmlParaLinha } from '../extract/html';
import { log } from '../logger';

export type Fonte = 'assign' | 'quiz' | 'calendario' | 'ficha' | 'cronograma' | 'secao';

export interface Compromisso {
  codigo: string;
  titulo: string;
  tipo: string;
  data: string;
  fonte: Fonte;
  status?: 'entregue' | 'pendente' | 'desconhecido';
  peso?: number | null;
  sigla?: string | null;
  confianca: 'exata' | 'estimada';
  quarentena?: boolean;
  dataAnterior?: string | null;
  conflito?: string | null;
}

const PRECEDENCIA: Record<Fonte, number> = {
  assign: 1, quiz: 2, calendario: 3, ficha: 4, cronograma: 5, secao: 6,
};

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'para', 'the']);

function tokens(s: string): Set<string> {
  // digito solto conta: sem ele "Prova 1" e "Prova 2" viram o mesmo token {prova}
  // e a Prova 2 herda o peso e a sigla da Prova 1.
  return new Set(
    normalizar(s)
      .split(' ')
      .filter((t) => (t.length > 1 || /\d/.test(t)) && !VAZIAS.has(t))
  );
}

/**
 * Dois numeros, de proposito:
 * - `cobertura` (inter/min) e o portao, generoso: "Semana 12: ... e PROVA" precisa
 *   alcancar "Prova";
 * - `jaccard` (inter/uniao) desempata, exigente: sem ele "Prova" casa 100% com
 *   "Prova de Recuperacao" e a prova errada leva a anotacao.
 */
/** "Prova" e "Prova de Recuperacao" sao avaliacoes distintas, nao a mesma. */
const SEGUNDA_CHANCE = /recupera|substitutiv|2a?\s*chamada|nova avalia|exame/i;

function similaridade(a: string, b: string): { cobertura: number; jaccard: number } {
  if (SEGUNDA_CHANCE.test(a) !== SEGUNDA_CHANCE.test(b)) return { cobertura: 0, jaccard: 0 };
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return { cobertura: 0, jaccard: 0 };

  let inter = 0;
  let interComPalavra = false;
  for (const t of ta) {
    if (!tb.has(t)) continue;
    inter++;
    if (!/^\d+$/.test(t)) interComPalavra = true;
  }
  // casar so pelo numero e coincidencia: "Trabalho Pratico 1" nao e "Prova 1"
  if (!interComPalavra) return { cobertura: 0, jaccard: 0 };

  return {
    cobertura: inter / Math.min(ta.size, tb.size),
    jaccard: inter / (ta.size + tb.size - inter),
  };
}

/** Anota peso e sigla vindos da ficha, casando por sigla ou por titulo. */
function anotarPeso(c: Compromisso, ficha: FichaSalva | undefined): void {
  if (!ficha) return;
  let melhor: { peso: number | null; sigla: string; score: number } | null = null;
  for (const a of ficha.ficha.avaliacoes || []) {
    const bateSigla = new RegExp(`\\b${a.sigla.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(c.titulo);
    const { cobertura, jaccard } = similaridade(a.nome, c.titulo);
    if (!bateSigla && cobertura < 0.5) continue;
    const score = bateSigla ? 1 + jaccard : jaccard;
    if (!melhor || score > melhor.score) melhor = { peso: a.peso ?? null, sigla: a.sigla, score };
  }
  if (melhor) {
    c.peso = melhor.peso;
    c.sigla = melhor.sigla;
  }
}

/**
 * Deduplica por (disciplina, data +-1 dia, titulo semelhante).
 * Moodle sempre vence o documento-mestre: o documento e intencao, o Moodle e o
 * que esta valendo. Data em disputa (quarentena) aparece duas vezes de proposito.
 */
function deduplicar(itens: Compromisso[]): Compromisso[] {
  const ordenados = [...itens].sort((a, b) => PRECEDENCIA[a.fonte] - PRECEDENCIA[b.fonte]);
  const aceitos: Compromisso[] = [];

  for (const novo of ordenados) {
    // melhor casamento, nao o primeiro: "Semana 12: ... e PROVA" pertence a
    // "Prova" (sim. 1,0), nao a "Apresentacoes do Trabalho" (sim. 0,5)
    let melhor: { alvo: Compromisso; sim: number } | null = null;
    for (const velho of aceitos) {
      if (velho.codigo !== novo.codigo) continue;
      const { cobertura, jaccard } = similaridade(velho.titulo, novo.titulo);
      if (cobertura < 0.5) continue;
      if (!melhor || jaccard > melhor.sim) melhor = { alvo: velho, sim: jaccard };
    }

    // Quarentena e a excecao ao "Moodle manda": a data em disputa fica visivel,
    // com a anterior anotada, ate eu confirmar qual vale (§8.4).
    if (novo.quarentena && novo.dataAnterior) {
      novo.conflito = `era ${ddmm(novo.dataAnterior)} na versao anterior — confirmar`;
      if (melhor && PRECEDENCIA[melhor.alvo.fonte] <= 3 && melhor.alvo.data === novo.dataAnterior) {
        novo.status = novo.status ?? melhor.alvo.status;
        aceitos[aceitos.indexOf(melhor.alvo)] = novo;
      } else if (!melhor) {
        aceitos.push(novo);
      }
      continue;
    }

    if (!melhor) {
      aceitos.push(novo);
      continue;
    }

    const dias = Math.abs(diffDias(melhor.alvo.data, novo.data));
    if (dias > 1 && PRECEDENCIA[novo.fonte] >= 4 && PRECEDENCIA[melhor.alvo.fonte] <= 3) {
      // conflito e informacao, nao erro: o Moodle manda, mas o documento fica registrado
      const como = novo.confianca === 'estimada' ? `~${ddmm(novo.data)}` : ddmm(novo.data);
      if (!melhor.alvo.conflito) {
        melhor.alvo.conflito = `documento-mestre indica ${como} — Moodle manda`;
      }
    } else if (dias > 1) {
      // Datas distintas = compromissos distintos, venham do Moodle ("Entrega 2" e
      // "Entrega 3") ou do mesmo documento ("Prova 1" semana 9 e "Prova 2" semana 16).
      // Absorver aqui apagaria uma prova inteira da agenda.
      aceitos.push(novo);
    }
  }

  return aceitos.sort((a, b) => a.data.localeCompare(b.data) || a.codigo.localeCompare(b.codigo));
}

const REVALIDA_APOS_MS = 12 * 3600 * 1000;
const ORCAMENTO_REVALIDACAO_MS = 6000;

/**
 * Professor remarca prova no meio do semestre. Um cache de 30 dias esconderia
 * isso, entao a agenda revalida o documento-mestre por hash quando a ultima
 * checagem passou de 12 h — em paralelo e com orcamento de tempo, porque a
 * agenda nao pode travar esperando a rede (§8.4).
 */
async function revalidarDocumentos(
  codigos: string[],
  forcar: boolean
): Promise<{ mudaram: string[]; semRevalidar: string[] }> {
  const limite = Date.now() - REVALIDA_APOS_MS;
  const pendentes = codigos.filter((codigo) => {
    if (forcar) return true;
    const r = db()
      .prepare('SELECT revalidado_em FROM planos_cache WHERE codigo = ?')
      .get(codigo) as { revalidado_em: string | null } | undefined;
    if (!r) return false; // nunca resolvido: quem resolve e a tool `plano`
    return !r.revalidado_em || new Date(r.revalidado_em).getTime() < limite;
  });

  if (pendentes.length === 0) return { mudaram: [], semRevalidar: [] };

  const mudaram: string[] = [];
  const semRevalidar: string[] = [];
  let expirou = false;
  let temporizador: NodeJS.Timeout | undefined;
  const relogio = new Promise<'timeout'>((r) => {
    temporizador = setTimeout(() => { expirou = true; r('timeout'); }, ORCAMENTO_REVALIDACAO_MS);
  });

  await Promise.race([
    Promise.allSettled(
      pendentes.map(async (codigo) => {
        try {
          const doc = await resolverDocumento(codigo, { revalidar: true });
          if (doc.mudanca && !expirou) mudaram.push(codigo);
        } catch (e) {
          log.debug(`revalidacao de ${codigo} falhou`, e);
          semRevalidar.push(codigo);
        }
      })
    ),
    relogio,
  ]);
  // sem isso o timer segura o event loop ate estourar, mesmo com o trabalho pronto
  if (temporizador) clearTimeout(temporizador);

  if (expirou) semRevalidar.push(...pendentes.filter((c) => !mudaram.includes(c)));
  return { mudaram, semRevalidar: [...new Set(semRevalidar)] };
}

export interface OpcoesAgenda {
  dias?: number;
  disciplina?: string;
  incluirEntregues?: boolean;
  refresh?: boolean;
  desde?: string;
}

export async function montarAgenda(op: OpcoesAgenda = {}): Promise<{
  cursos: Curso[];
  itens: Compromisso[];
  inicio: string;
  fim: string;
  alertas: string[];
}> {
  const dias = op.dias ?? 14;
  const refresh = op.refresh === true;
  const inicio = op.desde ?? hojeISO();
  const fim = somarDias(inicio, dias);
  const cursos = await resolverCursos(op.disciplina, refresh);
  const fichas = fichasSalvas();
  const brutos: Compromisso[] = [];
  const alertas: string[] = [];

  // fonte 1 — tarefas (prazo + se ja entreguei)
  const assigns = await assignsDe(cursos, refresh);
  const paraStatus: Array<{ assignid: number; duedate: number }> = [];
  for (const [codigo, lista] of assigns) {
    for (const a of lista) {
      if (!a.duedate) continue;
      paraStatus.push({ assignid: a.id, duedate: a.duedate });
      brutos.push({
        codigo,
        titulo: htmlParaLinha(a.name),
        tipo: 'tarefa',
        data: epochParaISO(a.duedate),
        fonte: 'assign',
        confianca: 'exata',
      });
    }
  }
  const status = await statusSubmissoes(paraStatus, refresh);
  const idPorTitulo = new Map<string, number>();
  for (const [codigo, lista] of assigns) {
    for (const a of lista) idPorTitulo.set(`${codigo}|${htmlParaLinha(a.name)}`, a.id);
  }
  for (const c of brutos) {
    if (c.fonte !== 'assign') continue;
    const id = idPorTitulo.get(`${c.codigo}|${c.titulo}`);
    c.status = id ? status.get(id) ?? 'desconhecido' : 'desconhecido';
  }

  // fonte 2 — quizzes, com tentativa ja finalizada marcada como entregue
  const quizzes = await quizzesDe(cursos, refresh);
  const statusQuiz = await statusQuizzesNaJanela(
    quizzes.filter((q) => q.quizid).map((q) => ({ quizid: q.quizid as number, timeclose: q.epoch })),
    refresh
  );
  for (const q of quizzes) {
    const st = q.quizid ? statusQuiz.get(q.quizid) : undefined;
    brutos.push({
      codigo: q.codigo,
      titulo: q.titulo,
      tipo: 'quiz',
      data: epochParaISO(q.epoch),
      fonte: 'quiz',
      confianca: 'exata',
      status: st === 'entregue' ? 'entregue' : st === undefined ? undefined : 'pendente',
    });
  }

  // fonte 3 — calendario do professor
  try {
    const eventos = await eventosCalendario(
      cursos,
      Math.floor(new Date(`${inicio}T00:00:00-03:00`).getTime() / 1000),
      Math.floor(new Date(`${fim}T23:59:59-03:00`).getTime() / 1000),
      refresh
    );
    for (const e of eventos) {
      brutos.push({
        codigo: e.codigo,
        titulo: e.titulo,
        tipo: 'evento',
        data: epochParaISO(e.epoch),
        fonte: 'calendario',
        confianca: 'exata',
      });
    }
  } catch (e) {
    log.debug('calendario indisponivel', e);
  }

  // fontes 4 e 5 — datas que so existem no documento-mestre
  const prazos = db()
    .prepare(
      `SELECT codigo, titulo, tipo, data, fonte, peso, sigla, confianca, quarentena, data_anterior
       FROM prazos WHERE fonte IN ('ficha','cronograma')`
    )
    .all() as Array<{
    codigo: string; titulo: string; tipo: string; data: string; fonte: Fonte;
    peso: number | null; sigla: string | null; confianca: 'exata' | 'estimada';
    quarentena: number; data_anterior: string | null;
  }>;
  const codigos = new Set(cursos.map((c) => c.codigo));
  for (const p of prazos) {
    if (!codigos.has(p.codigo)) continue;
    brutos.push({
      codigo: p.codigo,
      titulo: p.titulo,
      tipo: p.tipo,
      data: p.data,
      fonte: p.fonte,
      peso: p.peso,
      sigla: p.sigla,
      confianca: p.confianca,
      quarentena: p.quarentena === 1,
      dataAnterior: p.data_anterior,
    });
  }

  // fonte 6 — data no nome da secao do curso (CAD5103: "AULAS 1 e 2 - 12/08/2026")
  for (const curso of cursos) {
    try {
      const secoes = await conteudoBruto(curso, refresh);
      const ano = curso.startdate ? new Date(curso.startdate * 1000).getUTCFullYear() : new Date().getFullYear();
      for (const s of secoes) {
        const nome = htmlParaLinha(s.name);
        if (!nome) continue;
        const data = dataEmNomeDeSecao(nome, ano);
        if (!data) continue;
        brutos.push({
          codigo: curso.codigo,
          titulo: nome,
          tipo: 'aula',
          data,
          fonte: 'secao',
          confianca: 'exata',
        });
      }
    } catch (e) {
      log.debug(`secoes de ${curso.codigo} indisponiveis`, e);
    }
  }

  for (const c of brutos) anotarPeso(c, fichas.get(c.codigo));

  let itens = deduplicar(brutos).filter((c) => c.data >= inicio && c.data <= fim);

  if (!op.incluirEntregues) itens = itens.filter((c) => c.status !== 'entregue');

  // revalida antes de montar os alertas, para o aviso sair ja nesta resposta
  const revalidacao = await revalidarDocumentos([...fichas.keys()].filter((c) => codigos.has(c)), refresh);
  const fichasAgora = revalidacao.mudaram.length ? fichasSalvas() : fichas;
  if (revalidacao.semRevalidar.length) {
    alertas.push(`(sem revalidar: ${revalidacao.semRevalidar.join(', ')})`);
  }

  for (const [codigo, f] of fichasAgora) {
    if (codigos.has(codigo) && f.status === 'desatualizada') {
      alertas.push(`${codigo} documento-mestre mudou — ficha desatualizada, use plano("${codigo}","mudancas")`);
    }
  }

  // Quadro de texto novo ou editado que a ficha nao viu: e onde mora
  // "Prova 1: 08/10 as 20h20", que nao vira tarefa nem evento de calendario.
  for (const curso of cursos) {
    const f = fichas.get(curso.codigo);
    if (!f?.textosSha) continue;
    try {
      const mudaram = blocosNovosOuAlterados(f.textosSha, hashDosBlocos(await blocosDeTexto(curso.codigo, refresh)));
      if (mudaram.length) {
        alertas.push(
          `${curso.codigo} texto do professor mudou (${mudaram.join(', ')}) — ` +
            `nao refletido na ficha, use ler("${mudaram[0]}")`
        );
      }
    } catch (e) {
      log.debug(`${curso.codigo}: quadros de texto nao verificados`, e);
    }
  }
  const semFicha = cursos.filter((c) => !fichas.has(c.codigo)).map((c) => c.codigo);
  if (semFicha.length) {
    alertas.push(
      `sem ficha: ${semFicha.join(', ')} — pesos e provas do plano ficam de fora (use plano + salvar_ficha)`
    );
  }

  return { cursos, itens, inicio, fim, alertas };
}
