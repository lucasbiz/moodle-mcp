import { chamar } from './client';
import { comCache, TTL } from '../store/cache';
import { htmlParaLinha, htmlParaTexto } from '../extract/html';
import { Curso } from './cursos';
import { log } from '../logger';

export interface Aviso {
  codigo: string;
  forum: string;
  titulo: string;
  autor: string;
  epoch: number;
  corpo: string;
}

interface ForumWS {
  id: number;
  course: number;
  name: string;
  type: string;
}

interface DiscussaoWS {
  id?: number;
  discussion?: number;
  name: string;
  timemodified?: number;
  created?: number;
  userfullname?: string;
  message?: string;
}

export async function listarAvisos(
  cursos: Curso[],
  desdeEpoch: number,
  refresh = false
): Promise<Aviso[]> {
  if (cursos.length === 0) return [];
  const ids = cursos.map((c) => c.courseid);

  const foruns = await comCache<ForumWS[]>(`foruns:${ids.join(',')}`, TTL.cursos, refresh, () =>
    chamar<ForumWS[]>('mod_forum_get_forums_by_courses', { courseids: ids })
  );

  const avisos: Aviso[] = [];
  for (const f of foruns) {
    const curso = cursos.find((c) => c.courseid === f.course);
    if (!curso) continue;
    try {
      const resp = await comCache<{ discussions?: DiscussaoWS[] }>(
        `discussoes:${f.id}`,
        TTL.avisos,
        refresh,
        () => chamar('mod_forum_get_forum_discussions', { forumid: f.id, perpage: 15, page: 0 })
      );
      for (const d of resp.discussions || []) {
        const epoch = d.timemodified || d.created || 0;
        if (epoch < desdeEpoch) continue;
        avisos.push({
          codigo: curso.codigo,
          forum: htmlParaLinha(f.name),
          titulo: htmlParaLinha(d.name),
          autor: d.userfullname || '',
          epoch,
          corpo: htmlParaTexto(d.message),
        });
      }
    } catch (e) {
      log.debug(`forum ${f.id} (${f.name}) indisponivel`, e);
    }
  }

  // o mesmo aviso as vezes aparece em dois foruns da disciplina
  const vistos = new Set<string>();
  return avisos
    .sort((a, b) => b.epoch - a.epoch)
    .filter((a) => {
      const chave = `${a.codigo}|${a.titulo.toLowerCase()}|${Math.floor(a.epoch / 3600)}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
}
