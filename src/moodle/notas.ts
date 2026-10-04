import { chamar } from './client';
import { comCache, TTL } from '../store/cache';
import { htmlParaLinha } from '../extract/html';
import { Curso } from './cursos';
import { log } from '../logger';

export interface ItemNota {
  codigo: string;
  nome: string;
  nota: string | null;
  bruta: number | null;
  maximo: number | null;
  percentual: string | null;
  feedback: string | null;
}

interface GradeItemWS {
  itemname?: string;
  itemtype?: string;
  itemmodule?: string;
  graderaw?: number | null;
  gradeformatted?: string;
  grademax?: number;
  percentageformatted?: string;
  feedback?: string;
}

function semNota(v: string | undefined): boolean {
  const s = (v || '').trim();
  return s === '' || s === '-' || s === 'Ainda não foi avaliado';
}

export async function notasDe(cursos: Curso[], refresh = false): Promise<Map<string, ItemNota[]>> {
  const out = new Map<string, ItemNota[]>();
  const info = await chamar<{ userid: number }>('core_webservice_get_site_info');

  for (const curso of cursos) {
    try {
      const resp = await comCache<{ usergrades?: Array<{ gradeitems?: GradeItemWS[] }> }>(
        `notas:${curso.courseid}`,
        TTL.notas,
        refresh,
        () =>
          chamar('gradereport_user_get_grade_items', {
            courseid: curso.courseid,
            userid: info.userid,
          })
      );
      const itens: ItemNota[] = [];
      for (const gi of resp.usergrades?.[0]?.gradeitems || []) {
        const nome = htmlParaLinha(gi.itemname || (gi.itemtype === 'course' ? 'Total do curso' : ''));
        if (!nome) continue;
        itens.push({
          codigo: curso.codigo,
          nome,
          nota: semNota(gi.gradeformatted) ? null : (gi.gradeformatted as string).trim(),
          bruta: gi.graderaw ?? null,
          maximo: gi.grademax ?? null,
          percentual: semNota(gi.percentageformatted) ? null : (gi.percentageformatted as string).trim(),
          feedback: htmlParaLinha(gi.feedback || '', 160) || null,
        });
      }
      out.set(curso.codigo, itens);
    } catch (e) {
      log.debug(`notas de ${curso.codigo} indisponiveis`, e);
      out.set(curso.codigo, []);
    }
  }
  return out;
}
