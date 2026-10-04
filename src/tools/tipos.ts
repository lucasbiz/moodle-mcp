import { z } from 'zod';

export interface Ferramenta {
  nome: string;
  descricao: string;
  schema: z.ZodRawShape;
  executar: (args: any) => Promise<string>;
}

export const FORMATO = z.enum(['texto', 'json']).default('texto');

export const REFRESH = z.boolean().default(false);
