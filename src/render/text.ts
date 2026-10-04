/** Formatacao compacta (§5.2): texto, sem emoji, sem JSON quando nao pedido. */

export function tamanhoArquivo(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

export function truncar(s: string, max: number): string {
  const limpo = s.replace(/\s+/g, ' ').trim();
  if (limpo.length <= max) return limpo;
  return limpo.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

/** Alinha colunas sem gastar caractere a toa: uma coluna vazia some. */
export function colunas(linhas: string[][], separador = '  '): string {
  if (linhas.length === 0) return '';
  const n = Math.max(...linhas.map((l) => l.length));
  const larguras: number[] = [];
  for (let c = 0; c < n; c++) {
    larguras[c] = Math.max(0, ...linhas.map((l) => (l[c] || '').length));
  }
  return linhas
    .map((l) =>
      l
        .map((cel, i) => (i === l.length - 1 ? cel : (cel || '').padEnd(larguras[i])))
        .join(separador)
        .trimEnd()
    )
    .join('\n');
}

/** Truncamento explicito e barato (§5.5): o modelo sabe que ha mais e como pedir. */
export function marcarCorte(total: number, mostrados: number, dica: string): string | null {
  const restam = total - mostrados;
  if (restam <= 0) return null;
  return `  ... +${restam} ${restam === 1 ? 'item' : 'itens'} (use ${dica})`;
}

export function blocos(...partes: Array<string | null | undefined>): string {
  return partes.filter((p) => p && p.trim()).join('\n');
}

export function json(valor: unknown): string {
  return JSON.stringify(valor, null, 1);
}
