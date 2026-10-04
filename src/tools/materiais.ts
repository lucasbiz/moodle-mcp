import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { sincronizarItens, Item } from '../moodle/conteudo';
import { carregarConfig } from '../config';
import { colunas, blocos, truncar, tamanhoArquivo, marcarCorte, json } from '../render/text';
import { Ferramenta, FORMATO, REFRESH } from './tipos';

export function temTextoEmCache(item: Item & { sha256?: string | null }): boolean {
  if (!item.sha256) return false;
  const cfg = carregarConfig();
  return fs.existsSync(path.join(cfg.cacheDir, 'text', `${item.sha256}.txt`));
}

function dataCurta(epoch: number | null | undefined): string {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const materiais: Ferramenta = {
  nome: 'materiais',
  descricao: 'Lista os materiais de uma disciplina, sem o conteudo.',
  schema: {
    codigo: z.string().describe('ex INE5633'),
    tipo: z.enum(['pdf', 'link', 'pagina', 'pasta', 'tarefa', 'quiz', 'texto', 'arquivo']).optional(),
    secao: z.string().optional(),
    limite: z.number().int().min(1).max(200).default(15),
    refresh: REFRESH,
    formato: FORMATO,
  },
  async executar(args) {
    const codigo = String(args.codigo).toUpperCase();
    let itens = (await sincronizarItens(codigo, args.refresh === true)) as Array<Item & { sha256?: string | null }>;

    itens = itens.filter((i) => !['forum', 'attendance', 'groupselect', 'scheduler'].includes(i.modname || ''));
    if (args.tipo) itens = itens.filter((i) => i.tipo === args.tipo);
    if (args.secao) {
      const alvo = String(args.secao).toLowerCase();
      itens = itens.filter((i) => (i.secao || '').toLowerCase().includes(alvo));
    }

    const limite = args.limite ?? 15;
    const mostrados = itens.slice(0, limite);

    if (args.formato === 'json') {
      return json(
        mostrados.map((i) => ({
          id: i.id, nome: i.nome, tipo: i.tipo, secao: i.secao,
          tamanho: i.filesize, timemodified: i.timemodified, texto_em_cache: temTextoEmCache(i),
        }))
      );
    }

    const linhas = mostrados.map((i) => [
      `  /${i.idx}`,
      truncar(i.nome, 46),
      i.tipo,
      tamanhoArquivo(i.filesize),
      dataCurta(i.timemodified),
      temTextoEmCache(i) ? '[texto ok]' : '',
    ]);

    const corte = marcarCorte(itens.length, mostrados.length, `limite=${Math.min(200, itens.length)}`);
    // o alvo de ~200 tokens da §5.7 so fecha com default baixo (§5.5); o corte diz como pedir mais
    return blocos(
      `${codigo} materiais (${itens.length})`,
      colunas(linhas),
      corte,
      itens.length ? `ler com: ler("${codigo}/${mostrados[0]?.idx ?? 1}")` : 'nenhum material'
    );
  },
};
