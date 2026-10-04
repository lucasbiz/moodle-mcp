import { z } from 'zod';
import { montarAgenda, Compromisso } from '../agenda/unify';
import { ddmm, hojeISO, diffDias } from '../agenda/semanas';
import { colunas, blocos, json } from '../render/text';
import { Ferramenta, FORMATO, REFRESH } from './tipos';

function marca(c: Compromisso, hoje: string): string {
  const faltam = diffDias(hoje, c.data);
  if (c.status === 'entregue') return ' ';
  if (c.status === 'pendente' || (faltam >= 0 && faltam <= 3)) return '!';
  return ' ';
}

function rotuloStatus(c: Compromisso): string {
  if (c.status === 'entregue') return 'ENTREGUE';
  if (c.status === 'pendente') return 'PENDENTE';
  return '';
}

function rotuloPeso(c: Compromisso): string {
  if (c.peso == null) return c.sigla ? `(${c.sigla})` : '';
  return `${Math.round(c.peso * 100)}%${c.sigla ? ` (${c.sigla})` : ''}`;
}

export const agenda: Ferramenta = {
  nome: 'agenda',
  descricao: 'O que vem pela frente: prazos, provas, entregas e pendencias.',
  schema: {
    dias: z.number().int().min(1).max(180).default(14),
    disciplina: z.string().optional().describe('ex INE5617'),
    incluir_entregues: z.boolean().default(false),
    refresh: REFRESH,
    formato: FORMATO,
  },
  async executar(args) {
    const r = await montarAgenda({
      dias: args.dias ?? 14,
      disciplina: args.disciplina,
      incluirEntregues: args.incluir_entregues === true,
      refresh: args.refresh === true,
    });

    if (args.formato === 'json') {
      return json({ inicio: r.inicio, fim: r.fim, alertas: r.alertas, itens: r.itens });
    }

    const hoje = hojeISO();
    const nomes = new Map(r.cursos.map((c) => [c.codigo, c.nome]));
    const porCurso = new Map<string, Compromisso[]>();
    for (const c of r.itens) {
      if (!porCurso.has(c.codigo)) porCurso.set(c.codigo, []);
      porCurso.get(c.codigo)!.push(c);
    }

    const partes: string[] = [`AGENDA ${ddmm(r.inicio)}-${ddmm(r.fim)}`];
    for (const a of r.alertas) partes.push(`! ${a}`);
    partes.push('');

    if (porCurso.size === 0) {
      partes.push('nada no periodo.');
    }

    for (const [codigo, itens] of [...porCurso].sort()) {
      partes.push(`${codigo} ${nomes.get(codigo) ?? ''}`.trim());
      const linhas: string[][] = [];
      const extras: Array<[number, string]> = [];
      for (const c of itens) {
        linhas.push([
          `  ${marca(c, hoje)}`,
          c.confianca === 'estimada' ? `~${ddmm(c.data)}` : ddmm(c.data),
          c.titulo,
          c.tipo,
          rotuloStatus(c),
          rotuloPeso(c),
        ]);
        if (c.conflito) extras.push([linhas.length - 1, c.conflito]);
      }
      const bloco = colunas(linhas, ' ').split('\n');
      for (let i = 0; i < bloco.length; i++) {
        partes.push(bloco[i]);
        for (const [idx, texto] of extras) if (idx === i) partes.push(`          ${texto}`);
      }
      partes.push('');
    }

    return blocos(...partes).trimEnd();
  },
};
