import { createHash } from 'crypto';
import { sincronizarItens } from './conteudo';

export interface BlocoTexto {
  id: string;
  texto: string;
}

/**
 * Um quadro de texto na pagina do curso e onde o professor escreve o que nao
 * virou tarefa nem evento — "Prova 1: 08/10 as 20h20" mora so ali. Mas a maioria
 * e titulo de topico ("2.1 Iniciacao"), que nao deve custar token nenhum.
 *
 * Passa quem tem corpo (>= 40 chars) OU sinal de que carrega informacao datada.
 * A barra na data e proposital: `\d+\.\d+` casaria com "2.2.1 Planejamento".
 */
const RELEVANTE =
  /\d{1,2}\/\d{1,2}|\d{1,2}\s*h\s*\d{0,2}\b|\bprova|\bentrega|\bprazo|avalia|adiad|cancelad|remarcad|\bsala\b|\blink\b/i;

function substancial(texto: string): boolean {
  return texto.length >= 40 || RELEVANTE.test(texto);
}

export async function blocosDeTexto(codigo: string, refresh = false): Promise<BlocoTexto[]> {
  const itens = await sincronizarItens(codigo, refresh);
  const blocos: BlocoTexto[] = [];
  for (const i of itens) {
    if (i.tipo !== 'texto') continue;
    const texto = (i.descricao || i.nome || '').replace(/\s+/g, ' ').trim();
    if (!texto || !substancial(texto)) continue;
    blocos.push({ id: i.id, texto });
  }
  return blocos;
}

function sha8(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);
}

export type MapaSha = Record<string, string>;

export function hashDosBlocos(blocos: BlocoTexto[]): MapaSha {
  const out: MapaSha = {};
  for (const b of blocos) out[b.id] = sha8(b.texto);
  return out;
}

/** Ids que apareceram ou mudaram desde que a ficha foi gravada. */
export function blocosNovosOuAlterados(antes: MapaSha | null, agora: MapaSha): string[] {
  if (!antes) return [];
  return Object.keys(agora).filter((id) => antes[id] !== agora[id]);
}
