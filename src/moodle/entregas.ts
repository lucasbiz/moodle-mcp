import { chamar, emLotes } from './client';
import { cacheGet, cacheSet, TTL } from '../store/cache';
import { comCache } from '../store/cache';
import { htmlParaLinha } from '../extract/html';
import { Curso } from './cursos';
import { epochParaISO } from '../agenda/semanas';
import { log } from '../logger';

export type Situacao = 'entregue' | 'pendente' | 'em_andamento' | 'nao_iniciado' | 'desconhecido';

export interface Entrega {
  codigo: string;
  titulo: string;
  tipo: 'tarefa' | 'quiz';
  situacao: Situacao;
  prazo: string | null;
  quando: string | null;
  atrasado: boolean;
  nota: string | null;
  correcao: string | null;
  cmid: number | null;
}

interface AssignWS {
  id: number;
  cmid: number;
  name: string;
  duedate: number;
  cutoffdate?: number;
}

interface QuizWS {
  id: number;
  course: number;
  coursemodule: number;
  name: string;
  timeclose: number;
}

/** Estado cru de uma tarefa, sem interpretar. */
async function statusAssign(assignid: number): Promise<{
  situacao: Situacao;
  quando: number | null;
  correcao: string | null;
}> {
  const r = await chamar<{
    lastattempt?: {
      submission?: { status?: string; timemodified?: number };
      teamsubmission?: { status?: string; timemodified?: number };
      gradingstatus?: string;
    };
    feedback?: { gradefordisplay?: string };
  }>('mod_assign_get_submission_status', { assignid });

  const s = r.lastattempt?.submission ?? r.lastattempt?.teamsubmission;
  const bruto = s?.status;

  let situacao: Situacao;
  if (bruto === 'submitted') situacao = 'entregue';
  else if (bruto === 'draft') situacao = 'em_andamento';
  else if (bruto === 'new' || bruto === 'reopened') situacao = 'pendente';
  else if (!bruto) situacao = 'nao_iniciado';
  else situacao = 'desconhecido';

  const gs = r.lastattempt?.gradingstatus;
  const correcao =
    gs === 'graded'
      ? (r.feedback?.gradefordisplay ? htmlParaLinha(r.feedback.gradefordisplay) : 'corrigido')
      : situacao === 'entregue'
        ? 'aguardando correcao'
        : null;

  return {
    situacao,
    quando: situacao === 'entregue' && s?.timemodified ? s.timemodified : null,
    correcao,
  };
}

/** Estado cru de um questionario. */
export async function statusQuiz(quizid: number): Promise<{
  situacao: Situacao;
  quando: number | null;
  nota: string | null;
}> {
  const r = await chamar<{
    attempts?: Array<{ state?: string; timefinish?: number; sumgrades?: number | null }>;
  }>('mod_quiz_get_user_attempts', { quizid, status: 'all' });

  const tentativas = r.attempts || [];
  if (tentativas.length === 0) return { situacao: 'nao_iniciado', quando: null, nota: null };

  const finalizada = [...tentativas].reverse().find((a) => a.state === 'finished');
  if (finalizada) {
    return {
      situacao: 'entregue',
      quando: finalizada.timefinish || null,
      nota: finalizada.sumgrades != null ? String(finalizada.sumgrades) : null,
    };
  }
  if (tentativas.some((a) => a.state === 'inprogress')) {
    return { situacao: 'em_andamento', quando: null, nota: null };
  }
  return { situacao: 'desconhecido', quando: null, nota: null };
}

/**
 * Status de questionarios para a agenda: mesma janela e mesmo cache do
 * submission_status das tarefas, para nao virar uma rajada por pergunta.
 */
export async function statusQuizzesNaJanela(
  quizzes: Array<{ quizid: number; timeclose: number }>,
  refresh = false
): Promise<Map<number, Situacao>> {
  const out = new Map<number, Situacao>();
  const agoraS = Math.floor(Date.now() / 1000);
  const janela = quizzes.filter(
    (q) => q.timeclose > 0 && q.timeclose > agoraS - 30 * 86400 && q.timeclose < agoraS + 60 * 86400
  );

  await emLotes(janela, 6, async (q) => {
    const chave = `entrega:quiz:${q.quizid}`;
    const hit = refresh ? null : cacheGet<{ situacao: Situacao }>(chave);
    if (hit) {
      out.set(q.quizid, hit.situacao);
      return;
    }
    try {
      const dados = await statusQuiz(q.quizid);
      cacheSet(chave, dados, ttlDe(q.timeclose));
      out.set(q.quizid, dados.situacao);
    } catch (e) {
      log.debug(`status do quiz ${q.quizid} indisponivel`, e);
      out.set(q.quizid, 'desconhecido');
    }
  });

  return out;
}

function ttlDe(prazoEpoch: number): number {
  return prazoEpoch > 0 && prazoEpoch < Math.floor(Date.now() / 1000)
    ? TTL.submissaoVencida
    : TTL.submissao;
}

/**
 * Situacao de entrega de tarefas e questionarios. Uma chamada de rede por
 * atividade, entao roda em paralelo e com cache — mas sem a janela de tempo da
 * agenda: aqui a pergunta e explicita ("ja entreguei X?") e a resposta precisa
 * existir mesmo para atividade antiga ou sem prazo.
 */
export async function situacaoEntregas(
  cursos: Curso[],
  op: { refresh?: boolean; comPrazoApenas?: boolean } = {}
): Promise<Entrega[]> {
  if (cursos.length === 0) return [];
  const refresh = op.refresh === true;
  const ids = cursos.map((c) => c.courseid);
  const out: Entrega[] = [];

  const respAssign = await comCache<{ courses?: Array<{ id: number; assignments?: AssignWS[] }> }>(
    `assigns:${ids.join(',')}`,
    TTL.assigns,
    refresh,
    () => chamar('mod_assign_get_assignments', { courseids: ids })
  );

  const tarefas: Array<{ curso: Curso; a: AssignWS }> = [];
  for (const c of respAssign.courses || []) {
    const curso = cursos.find((x) => x.courseid === c.id);
    if (!curso) continue;
    for (const a of c.assignments || []) {
      if (op.comPrazoApenas && !a.duedate) continue;
      tarefas.push({ curso, a });
    }
  }

  await emLotes(tarefas, 6, async ({ curso, a }) => {
    const chave = `entrega:assign:${a.id}`;
    let dados = refresh ? null : cacheGet<{ situacao: Situacao; quando: number | null; correcao: string | null }>(chave);
    if (!dados) {
      try {
        dados = await statusAssign(a.id);
        cacheSet(chave, dados, ttlDe(a.duedate));
      } catch (e) {
        log.debug(`status da tarefa ${a.id} indisponivel`, e);
        dados = { situacao: 'desconhecido', quando: null, correcao: null };
      }
    }
    out.push({
      codigo: curso.codigo,
      titulo: htmlParaLinha(a.name),
      tipo: 'tarefa',
      situacao: dados.situacao,
      prazo: a.duedate ? epochParaISO(a.duedate) : null,
      quando: dados.quando ? epochParaISO(dados.quando) : null,
      atrasado: !!(dados.quando && a.duedate && dados.quando > a.duedate),
      nota: null,
      correcao: dados.correcao,
      cmid: a.cmid,
    });
  });

  const respQuiz = await comCache<{ quizzes?: QuizWS[] }>(
    `quizzes:${ids.join(',')}`,
    TTL.quizzes,
    refresh,
    () => chamar('mod_quiz_get_quizzes_by_courses', { courseids: ids })
  );

  const quizzes = (respQuiz.quizzes || [])
    .map((q) => ({ curso: cursos.find((x) => x.courseid === q.course), q }))
    .filter((x): x is { curso: Curso; q: QuizWS } => !!x.curso)
    .filter((x) => !op.comPrazoApenas || !!x.q.timeclose);

  await emLotes(quizzes, 6, async ({ curso, q }) => {
    const chave = `entrega:quiz:${q.id}`;
    let dados = refresh ? null : cacheGet<{ situacao: Situacao; quando: number | null; nota: string | null }>(chave);
    if (!dados) {
      try {
        dados = await statusQuiz(q.id);
        cacheSet(chave, dados, ttlDe(q.timeclose));
      } catch (e) {
        log.debug(`status do quiz ${q.id} indisponivel`, e);
        dados = { situacao: 'desconhecido', quando: null, nota: null };
      }
    }
    out.push({
      codigo: curso.codigo,
      titulo: htmlParaLinha(q.name),
      tipo: 'quiz',
      situacao: dados.situacao,
      prazo: q.timeclose ? epochParaISO(q.timeclose) : null,
      quando: dados.quando ? epochParaISO(dados.quando) : null,
      atrasado: !!(dados.quando && q.timeclose && dados.quando > q.timeclose),
      nota: dados.nota,
      correcao: null,
      cmid: q.coursemodule,
    });
  });

  return out.sort(
    (a, b) =>
      a.codigo.localeCompare(b.codigo) ||
      (a.prazo || '9999').localeCompare(b.prazo || '9999') ||
      a.titulo.localeCompare(b.titulo)
  );
}
