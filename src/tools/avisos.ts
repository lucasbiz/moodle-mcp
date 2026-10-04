import { z } from 'zod';
import { resolverCursos } from '../moodle/cursos';
import { listarAvisos } from '../moodle/foruns';
import { blocos, truncar, marcarCorte, json } from '../render/text';
import { ddmm, epochParaISO } from '../agenda/semanas';
import { Ferramenta, FORMATO, REFRESH } from './tipos';

export const avisos: Ferramenta = {
  nome: 'avisos',
  descricao: 'Avisos dos professores e novidades nos foruns.',
  schema: {
    dias: z.number().int().min(1).max(180).default(14),
    disciplina: z.string().optional().describe('ex INE5617'),
    limite: z.number().int().min(1).max(50).default(15),
    refresh: REFRESH,
    formato: FORMATO,
  },
  async executar(args) {
    const dias = args.dias ?? 14;
    const limite = args.limite ?? 15;
    const cursos = await resolverCursos(args.disciplina, args.refresh === true);
    const desde = Math.floor(Date.now() / 1000) - dias * 86400;
    const todos = await listarAvisos(cursos, desde, args.refresh === true);
    const mostrados = todos.slice(0, limite);

    if (args.formato === 'json') return json(mostrados);

    if (mostrados.length === 0) return `AVISOS ${dias}d: nenhum.`;

    // com limite=1 o corpo sai inteiro; ler_aviso nao precisa existir como tool
    const maxCorpo = limite === 1 ? 4000 : 300;
    const partes: string[] = [`AVISOS ultimos ${dias} dias (${todos.length})`, ''];
    for (const a of mostrados) {
      const data = ddmm(epochParaISO(a.epoch));
      partes.push(`${a.codigo} ${data} ${a.titulo}${a.autor ? ` — ${a.autor}` : ''}`);
      if (a.corpo) partes.push(`  ${truncar(a.corpo, maxCorpo)}`);
      partes.push('');
    }
    const corte = marcarCorte(todos.length, mostrados.length, `limite=${Math.min(50, todos.length)}`);
    return blocos(...partes, corte).trimEnd();
  },
};
