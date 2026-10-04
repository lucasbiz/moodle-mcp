import { z } from 'zod';
import { resolverCursos } from '../moodle/cursos';
import { notasDe, ItemNota } from '../moodle/notas';
import { lerFicha } from '../planos/fichas';
import { blocos, truncar, json } from '../render/text';
import { Ferramenta, FORMATO, REFRESH } from './tipos';

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function similaridade(a: string, b: string): number {
  const ta = new Set(normalizar(a).split(' ').filter((t) => t.length > 1));
  const tb = new Set(normalizar(b).split(' ').filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

function casar(sigla: string, nome: string, itens: ItemNota[]): ItemNota | null {
  const re = new RegExp(`\\b${sigla.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  let melhor: { item: ItemNota; score: number } | null = null;
  for (const i of itens) {
    const score = re.test(i.nome) ? 1 : similaridade(nome, i.nome);
    if (score >= 0.5 && (!melhor || score > melhor.score)) melhor = { item: i, score };
  }
  return melhor?.item ?? null;
}

export const notas: Ferramenta = {
  nome: 'notas',
  descricao: 'Notas lancadas, o que ainda nao tem nota e a media parcial.',
  schema: {
    disciplina: z.string().optional().describe('ex INE5617'),
    refresh: REFRESH,
    formato: FORMATO,
  },
  async executar(args) {
    const cursos = await resolverCursos(args.disciplina, args.refresh === true);
    const porCurso = await notasDe(cursos, args.refresh === true);

    if (args.formato === 'json') {
      return json(Object.fromEntries([...porCurso].map(([k, v]) => [k, v])));
    }

    const partes: string[] = [];
    for (const curso of cursos) {
      const itens = (porCurso.get(curso.codigo) || []).filter((i) => !/^total do curso$/i.test(i.nome));
      const salva = lerFicha(curso.codigo);

      if (!salva) {
        const comNota = itens.filter((i) => i.nota);
        if (comNota.length === 0) {
          partes.push(`${curso.codigo}  sem notas lancadas  (sem ficha: pesos desconhecidos)`);
        } else {
          partes.push(
            `${curso.codigo}  ` +
              comNota.map((i) => `${truncar(i.nome, 24)} ${i.nota}`).join('   ') +
              '   (sem ficha: parcial nao calculado)'
          );
        }
        continue;
      }

      const f = salva.ficha;
      const pedacos: string[] = [];
      let parcial = 0;
      const faltam: string[] = [];
      let algumaNota = false;

      for (const a of f.avaliacoes || []) {
        const item = casar(a.sigla, a.nome, itens);
        const max = item?.maximo ?? 10;
        const peso = a.peso == null ? null : `${Math.round(a.peso * 100)}%`;
        if (item && item.bruta != null) {
          algumaNota = true;
          pedacos.push(`${a.sigla} ${item.bruta}/${max}${peso ? ` (${peso})` : ''}`);
          if (a.peso != null && max) parcial += (item.bruta / max) * 10 * a.peso;
        } else {
          pedacos.push(`${a.sigla} -/${max}${peso ? ` (${peso})` : ''}`);
          faltam.push(a.sigla);
        }
      }

      let cauda: string;
      if (!f.pesos_conhecidos) {
        cauda = 'pesos nao informados no documento';
      } else if (!algumaNota) {
        cauda = 'nada lancado ainda';
      } else {
        cauda = `parcial ${parcial.toFixed(1)}` + (faltam.length ? `, falta ${faltam.join(' e ')}` : ' (final)');
      }

      partes.push(`${curso.codigo}  ${pedacos.join('   ')}   ${cauda}`);
      if (salva.status === 'desatualizada') {
        partes.push(`  ! ficha desatualizada — use plano("${curso.codigo}","mudancas")`);
      }
      const feedbacks = itens.filter((i) => i.feedback);
      for (const fb of feedbacks.slice(0, 3)) {
        partes.push(`  ${truncar(fb.nome, 28)}: ${truncar(fb.feedback!, 110)}`);
      }
    }

    return blocos(...partes) || 'nenhuma disciplina.';
  },
};
