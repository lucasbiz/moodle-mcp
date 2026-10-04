const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', bull: '*', middot: '*',
  aacute: 'á', agrave: 'à', atilde: 'ã', acirc: 'â', eacute: 'é', ecirc: 'ê',
  iacute: 'í', oacute: 'ó', otilde: 'õ', ocirc: 'ô', uacute: 'ú', ccedil: 'ç',
  Aacute: 'Á', Atilde: 'Ã', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Otilde: 'Õ',
  Uacute: 'Ú', Ccedil: 'Ç', deg: 'o', ordf: 'a', ordm: 'o',
};

export function decodificarEntidades(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, nome) => ENTIDADES[nome] ?? m);
}

/**
 * HTML -> texto. Quebra em block-level, preserva linhas de tabela com " | ".
 * Nenhum campo HTML do Moodle atravessa a fronteira de uma tool (§5.6).
 */
export function htmlParaTexto(html: string | null | undefined): string {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|blockquote)>/gi, '\n');
  s = s.replace(/<(p|div|li|tr|h[1-6]|section|article)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(td|th)>\s*(?=<(td|th)\b)/gi, ' | ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodificarEntidades(s);
  s = s.replace(/ /g, ' ');
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Versao de uma linha so, para campos curtos (nome de modulo, assunto de post). */
export function htmlParaLinha(html: string | null | undefined, max = 0): string {
  let s = htmlParaTexto(html).replace(/\s+/g, ' ').trim();
  if (max > 0 && s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '...';
  return s;
}

/** Normaliza para hash estavel: sem espacos variaveis, sem CR. */
export function normalizarParaHash(texto: string): string {
  return texto
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}
