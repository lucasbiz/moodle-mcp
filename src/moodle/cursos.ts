import { chamar } from './client';
import { comCache, TTL } from '../store/cache';
import { db, agora } from '../store/db';
import { carregarConfig } from '../config';
import { log } from '../logger';

export interface Curso {
  codigo: string;
  courseid: number;
  turma: string;
  nome: string;
  professor: string | null;
  startdate: number | null;
  semestre: string;
}

interface CursoWS {
  id: number;
  shortname: string;
  fullname: string;
  idnumber: string;
  startdate?: number;
  visible?: number;
}

/** `turma|CAGR|GR|238|20262|INE5617|07238` -> codigo, turma, semestre. Sem regex no nome. */
export function parseIdnumber(idnumber: string): { codigo: string; turma: string; semestre: string } | null {
  const p = (idnumber || '').split('|');
  if (p.length < 7 || p[0] !== 'turma') return null;
  const semestre = p[4];
  const codigo = p[5];
  const turma = p[6];
  if (!/^\d{5}$/.test(semestre) || !/^[A-Z]{3}\d{4}$/.test(codigo)) return null;
  return { codigo, turma, semestre };
}

/** Remove o prefixo "INE5633-07238 (20262) - " do fullname. */
function nomeLimpo(fullname: string): string {
  const i = fullname.indexOf(' - ');
  return (i > 0 ? fullname.slice(i + 3) : fullname).trim();
}

async function buscarProfessores(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  try {
    const r = await chamar<{ courses?: Array<{ id: number; contacts?: Array<{ fullname: string }> }> }>(
      'core_course_get_courses_by_field',
      { field: 'ids', value: ids.join(',') }
    );
    for (const c of r.courses || []) {
      const nomes = (c.contacts || []).map((x) => x.fullname).filter(Boolean);
      if (nomes.length) out.set(c.id, nomes.join(', '));
    }
  } catch (e) {
    log.warn('professores indisponiveis', e);
  }
  return out;
}

/**
 * Disciplinas do semestre corrente. Quando SEMESTRE=auto e a deducao por data
 * nao casa com nenhuma matricula, cai no semestre mais recente matriculado —
 * semestre fixo e o tipo de coisa que quebra em silencio em marco.
 */
export async function listarCursos(refresh = false): Promise<Curso[]> {
  const cfg = carregarConfig();
  const chave = `cursos:${cfg.semestre}`;

  const cursos = await comCache<Curso[]>(chave, TTL.cursos, refresh, async () => {
    const info = await chamar<{ userid: number }>('core_webservice_get_site_info');
    const brutos = await chamar<CursoWS[]>('core_enrol_get_users_courses', { userid: info.userid });

    const disciplinas = brutos
      .map((c) => ({ c, meta: parseIdnumber(c.idnumber) }))
      .filter((x): x is { c: CursoWS; meta: NonNullable<ReturnType<typeof parseIdnumber>> } => x.meta !== null);

    let alvo = cfg.semestre;
    if (!disciplinas.some((d) => d.meta.semestre === alvo)) {
      const semestres = [...new Set(disciplinas.map((d) => d.meta.semestre))].sort();
      const recente = semestres[semestres.length - 1];
      if (recente) {
        if (cfg.semestreAuto) {
          log.warn(`nenhuma matricula em ${alvo}; usando ${recente}`);
        } else {
          log.warn(`SEMESTRE=${alvo} sem matriculas; usando ${recente}`);
        }
        alvo = recente;
      }
    }

    const doSemestre = disciplinas.filter((d) => d.meta.semestre === alvo);
    const professores = await buscarProfessores(doSemestre.map((d) => d.c.id));

    return doSemestre
      .map(({ c, meta }) => ({
        codigo: meta.codigo,
        courseid: c.id,
        turma: meta.turma,
        nome: nomeLimpo(c.fullname),
        professor: professores.get(c.id) ?? null,
        startdate: c.startdate || null,
        semestre: meta.semestre,
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  });

  const stmt = db().prepare(
    `INSERT INTO cursos (codigo, courseid, turma, nome, professor, horario, startdate, semestre, atualizado_em)
     VALUES (@codigo, @courseid, @turma, @nome, @professor, NULL, @startdate, @semestre, @atualizado_em)
     ON CONFLICT(codigo) DO UPDATE SET
       courseid = excluded.courseid, turma = excluded.turma, nome = excluded.nome,
       professor = excluded.professor, startdate = excluded.startdate,
       semestre = excluded.semestre, atualizado_em = excluded.atualizado_em`
  );
  const tx = db().transaction((lista: Curso[]) => {
    for (const c of lista) stmt.run({ ...c, atualizado_em: agora() });
  });
  tx(cursos);

  return cursos;
}

export async function acharCurso(codigo: string, refresh = false): Promise<Curso> {
  const alvo = codigo.trim().toUpperCase();
  const cursos = await listarCursos(refresh);
  const c = cursos.find((x) => x.codigo === alvo);
  if (!c) {
    throw new Error(
      `disciplina "${codigo}" nao encontrada no semestre. Disponiveis: ${cursos.map((x) => x.codigo).join(', ')}`
    );
  }
  return c;
}

export async function resolverCursos(disciplina: string | undefined, refresh = false): Promise<Curso[]> {
  if (disciplina && disciplina.trim()) return [await acharCurso(disciplina, refresh)];
  return listarCursos(refresh);
}
