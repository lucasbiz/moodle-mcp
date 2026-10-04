import { chamar, emLotes } from './client';
import { comCache, cacheGet, cacheSet, TTL } from '../store/cache';
import { htmlParaLinha } from '../extract/html';
import { Curso } from './cursos';
import { log } from '../logger';

export interface EventoMoodle {
  codigo: string;
  titulo: string;
  tipo: 'tarefa' | 'quiz' | 'evento';
  epoch: number;
  fonte: 'assign' | 'quiz' | 'calendario';
  status?: 'entregue' | 'pendente' | 'desconhecido';
  cmid?: number;
  assignid?: number;
  quizid?: number;
}

interface AssignWS {
  id: number;
  cmid: number;
  name: string;
  duedate: number;
  cutoffdate?: number;
  allowsubmissionsfromdate?: number;
  nosubmissions?: number;
  teamsubmission?: number;
}

/** Fonte 1: tarefas, com prazo. */
export async function assignsDe(cursos: Curso[], refresh = false): Promise<Map<string, AssignWS[]>> {
  const out = new Map<string, AssignWS[]>();
  if (cursos.length === 0) return out;
  const ids = cursos.map((c) => c.courseid);
  const resp = await comCache<{ courses?: Array<{ id: number; assignments?: AssignWS[] }> }>(
    `assigns:${ids.join(',')}`,
    TTL.assigns,
    refresh,
    () => chamar('mod_assign_get_assignments', { courseids: ids })
  );
  for (const c of resp.courses || []) {
    const curso = cursos.find((x) => x.courseid === c.id);
    if (!curso) continue;
    out.set(curso.codigo, c.assignments || []);
  }
  return out;
}

/** Fonte 2: quizzes (timeclose). */
export async function quizzesDe(cursos: Curso[], refresh = false): Promise<EventoMoodle[]> {
  if (cursos.length === 0) return [];
  const ids = cursos.map((c) => c.courseid);
  const resp = await comCache<{ quizzes?: Array<{ id: number; course: number; coursemodule: number; name: string; timeclose: number }> }>(
    `quizzes:${ids.join(',')}`,
    TTL.quizzes,
    refresh,
    () => chamar('mod_quiz_get_quizzes_by_courses', { courseids: ids })
  );
  const eventos: EventoMoodle[] = [];
  for (const q of resp.quizzes || []) {
    if (!q.timeclose) continue;
    const curso = cursos.find((x) => x.courseid === q.course);
    if (!curso) continue;
    eventos.push({
      codigo: curso.codigo,
      titulo: htmlParaLinha(q.name),
      tipo: 'quiz',
      epoch: q.timeclose,
      fonte: 'quiz',
      cmid: q.coursemodule,
      quizid: q.id,
    });
  }
  return eventos;
}

/** Fonte 3: eventos lancados pelo professor no calendario. */
export async function eventosCalendario(
  cursos: Curso[],
  de: number,
  ate: number,
  refresh = false
): Promise<EventoMoodle[]> {
  if (cursos.length === 0) return [];
  const ids = cursos.map((c) => c.courseid);
  const chave = `calendario:${ids.join(',')}:${Math.floor(de / 86400)}:${Math.floor(ate / 86400)}`;
  const resp = await comCache<{
    groupedbycourse?: Array<{ courseid: number; events?: Array<{ name: string; timesort: number; modulename?: string; instance?: number }> }>;
  }>(chave, TTL.calendario, refresh, () =>
    chamar('core_calendar_get_action_events_by_courses', {
      courseids: ids,
      timesortfrom: de,
      timesortto: ate,
    })
  );

  const eventos: EventoMoodle[] = [];
  for (const g of resp.groupedbycourse || []) {
    const curso = cursos.find((x) => x.courseid === g.courseid);
    if (!curso) continue;
    for (const e of g.events || []) {
      eventos.push({
        codigo: curso.codigo,
        titulo: htmlParaLinha(e.name),
        tipo: 'evento',
        epoch: e.timesort,
        fonte: 'calendario',
      });
    }
  }
  return eventos;
}

/**
 * Status de entrega. Uma chamada por assign, so na janela [-30d, +60d],
 * em paralelo e com TTL — 22 assigns nao podem virar 22 round-trips por pergunta.
 */
export async function statusSubmissoes(
  assigns: Array<{ assignid: number; duedate: number }>,
  refresh = false
): Promise<Map<number, 'entregue' | 'pendente' | 'desconhecido'>> {
  const out = new Map<number, 'entregue' | 'pendente' | 'desconhecido'>();
  const agoraS = Math.floor(Date.now() / 1000);
  const janela = assigns.filter(
    (a) => a.duedate > 0 && a.duedate > agoraS - 30 * 86400 && a.duedate < agoraS + 60 * 86400
  );

  const pendentesDeRede: typeof janela = [];
  for (const a of janela) {
    const chave = `submissao:${a.assignid}`;
    const hit = refresh ? null : cacheGet<string>(chave);
    if (hit) out.set(a.assignid, hit as 'entregue' | 'pendente');
    else pendentesDeRede.push(a);
  }

  await emLotes(pendentesDeRede, 6, async (a) => {
    try {
      const r = await chamar<{
        lastattempt?: {
          submission?: { status?: string };
          teamsubmission?: { status?: string };
        };
      }>('mod_assign_get_submission_status', { assignid: a.assignid });
      const st = r.lastattempt?.submission?.status || r.lastattempt?.teamsubmission?.status;
      const valor: 'entregue' | 'pendente' = st === 'submitted' ? 'entregue' : 'pendente';
      out.set(a.assignid, valor);
      const ttl = a.duedate < agoraS ? TTL.submissaoVencida : TTL.submissao;
      cacheSet(`submissao:${a.assignid}`, valor, ttl);
    } catch (e) {
      log.debug(`submission_status ${a.assignid} falhou`, e);
      out.set(a.assignid, 'desconhecido');
    }
  });

  for (const a of assigns) if (!out.has(a.assignid)) out.set(a.assignid, 'desconhecido');
  return out;
}
