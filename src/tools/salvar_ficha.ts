import { z } from 'zod';
import { salvarFicha, FichaInvalida, Ficha } from '../planos/fichas';
import { Ferramenta } from './tipos';

const avaliacao = z.object({
  sigla: z.string(),
  nome: z.string(),
  peso: z.number().nullable().describe('fracao 0..1; null se nao informado'),
  composicao: z.string().nullish(),
  data: z.string().nullish().describe('yyyy-mm-dd'),
  grupo: z.boolean().nullish(),
});

const fichaSchema = z.object({
  professor: z.string().nullish(),
  horario: z.string().nullish(),
  formula: z.string().nullish(),
  pesos_conhecidos: z.boolean(),
  avaliacoes: z.array(avaliacao),
  nao_vale_nota: z.array(z.string()).nullish(),
  recuperacao: z.object({ regra: z.string().nullish(), data: z.string().nullish() }).nullish(),
  frequencia: z.string().nullish(),
  cronograma: z
    .object({
      tipo: z.enum(['semanas', 'datas']),
      marcos: z.array(
        z.object({
          semana: z.number().int().nullish(),
          data: z.string().nullish(),
          o_que: z.string(),
        })
      ),
    })
    .nullish(),
});

export const salvar_ficha: Ferramenta = {
  nome: 'salvar_ficha',
  descricao: 'Grava a ficha destilada da disciplina (avaliacoes, pesos, datas, regras).',
  schema: {
    codigo: z.string().describe('ex INE5617'),
    ficha: fichaSchema,
  },
  async executar(args) {
    const codigo = String(args.codigo).toUpperCase();
    try {
      const r = await salvarFicha(codigo, { ...(args.ficha as object), codigo } as Ficha);
      const f = args.ficha as z.infer<typeof fichaSchema>;
      const n = f.avaliacoes?.length ?? 0;
      return (
        `ficha de ${codigo} gravada: ${n} avaliacoes, ${r.prazos} datas na agenda` +
        (f.pesos_conhecidos ? '' : ', pesos nao informados no documento')
      );
    } catch (e) {
      if (e instanceof FichaInvalida) return `ficha NAO gravada — ${e.message}`;
      throw e;
    }
  },
};
