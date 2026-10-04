import { z } from 'zod';
import { acharItem } from '../moodle/conteudo';
import { lerItem, NaoLegivel, PdfSemTexto } from '../extract/leitura';
import { blocos } from '../render/text';
import { Ferramenta, REFRESH } from './tipos';

export const ler: Ferramenta = {
  nome: 'ler',
  descricao: 'Le um material: PDF vira texto, link externo vira texto, paginado.',
  schema: {
    id: z.string().describe('ex INE5633/3 (veja materiais)'),
    de: z.number().int().min(1).default(1),
    ate: z.number().int().min(1).optional(),
    refresh: REFRESH,
  },
  async executar(args) {
    const item = await acharItem(String(args.id));

    let leitura;
    try {
      leitura = await lerItem(item, args.refresh === true);
    } catch (e) {
      if (e instanceof PdfSemTexto || e instanceof NaoLegivel) return `${item.id}: ${e.message}`;
      throw e;
    }

    const total = leitura.paginas.length;
    const de = Math.max(1, Math.min(args.de ?? 1, total));
    const ate = Math.max(de, Math.min(args.ate ?? de + 9, total));
    const fatia = leitura.paginas.slice(de - 1, ate);

    const cabecalho =
      `${item.id} ${item.nome} [${leitura.unidade} ${de}-${ate} de ${total}]` +
      (ate < total ? `  continua: ler("${item.id}", de=${ate + 1})` : '');

    const corpo = fatia
      .map((p, i) => (total > 1 ? `--- ${leitura.unidade} ${de + i} ---\n${p}` : p))
      .join('\n\n');

    return blocos(cabecalho, '', corpo);
  },
};
