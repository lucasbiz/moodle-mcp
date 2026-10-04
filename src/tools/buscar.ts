import { z } from 'zod';
import { db } from '../store/db';
import { blocos, truncar, marcarCorte, json } from '../render/text';
import { Ferramenta, FORMATO } from './tipos';

/** FTS5 aceita sintaxe propria; termos do usuario entram como frase segura. */
function consultaSegura(termo: string): string {
  const palavras = termo
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (palavras.length === 0) return '';
  return palavras.map((p) => `"${p}"`).join(' AND ');
}

export const buscar: Ferramenta = {
  nome: 'buscar',
  descricao: 'Busca full-text no material ja baixado.',
  schema: {
    termo: z.string(),
    disciplina: z.string().optional().describe('ex INE5633'),
    limite: z.number().int().min(1).max(40).default(8),
    formato: FORMATO,
  },
  async executar(args) {
    const consulta = consultaSegura(String(args.termo));
    if (!consulta) return 'termo vazio.';
    const limite = args.limite ?? 8;

    const filtroCurso = args.disciplina ? String(args.disciplina).toUpperCase() : null;
    const sql =
      `SELECT f.item_id AS item_id, f.codigo AS codigo, f.pagina AS pagina,
              snippet(textos_fts, 3, '[', ']', ' ... ', 18) AS trecho,
              i.nome AS nome
       FROM textos_fts f JOIN itens i ON i.id = f.item_id
       WHERE textos_fts MATCH ?` +
      (filtroCurso ? ' AND f.codigo = ?' : '') +
      ' ORDER BY rank LIMIT ?';

    let linhas: Array<{ item_id: string; codigo: string; pagina: number; trecho: string; nome: string }>;
    try {
      const params: unknown[] = filtroCurso ? [consulta, filtroCurso, limite + 1] : [consulta, limite + 1];
      linhas = db().prepare(sql).all(...params) as typeof linhas;
    } catch (e) {
      return `busca falhou: ${(e as Error).message}`;
    }

    if (args.formato === 'json') return json(linhas.slice(0, limite));

    if (linhas.length === 0) {
      return `"${args.termo}": nada no material ja lido. ` +
        'A busca so ve o que passou por ler() — leia o material antes, ou use materiais para achar o arquivo.';
    }

    const mostrados = linhas.slice(0, limite);
    const partes = [`BUSCA "${args.termo}" (${mostrados.length})`, ''];
    for (const l of mostrados) {
      partes.push(`${l.item_id} ${truncar(l.nome, 44)}  pag. ${l.pagina}`);
      partes.push(`  ${truncar(l.trecho, 150)}`);
    }
    const corte = linhas.length > limite ? marcarCorte(limite + 1, limite, `limite=${limite + 10}`) : null;
    return blocos(...partes, corte).trimEnd();
  },
};
