import { carregarConfig } from '../config';
import { baixarPublico } from '../moodle/files';
import { htmlParaTexto } from '../extract/html';
import { log } from '../logger';

export class PlanoInexistente extends Error {}

/** https://programas-planos.inf.ufsc.br/disciplinas/INE5617/turmas/07238/plano/20262 */
export function urlDerivada(codigo: string, turma: string, semestre: string): string {
  const cfg = carregarConfig();
  return `${cfg.catalogoUrl}/disciplinas/${codigo}/turmas/${turma}/plano/${semestre}`;
}

export function ehUrlDoCatalogo(url: string): boolean {
  const cfg = carregarConfig();
  try {
    return new URL(url).host === new URL(cfg.catalogoUrl).host;
  } catch {
    return false;
  }
}

const RUIDO = [
  /^Cat[aá]logo de Programas e Planos de Ensino$/i,
  /^Visitante \| Entrar$/i,
  /^In[ií]cio$/i,
  /^Planos de Ensino$/i,
  /^PT \| EN$/i,
  /^Entrar$/i,
];

function limparCabecalho(texto: string): string {
  return texto
    .split('\n')
    .filter((l) => !RUIDO.some((re) => re.test(l.trim())))
    .join('\n')
    .trim();
}

export interface PaginaCatalogo {
  url: string;
  titulo: string;
  texto: string;
}

/**
 * O catalogo responde HTTP 200 mesmo para disciplina que nao e do INE, com ~2 KB
 * e a frase "Plano desconhecido". Menos de 4 KB de HTML, esse marcador, ou
 * ausencia de "1. Identificacao" = nao existe (§8, via 2).
 */
export async function buscarPlanoCatalogo(url: string): Promise<PaginaCatalogo> {
  const { corpo, status } = await baixarPublico(url);
  if (status !== 200) throw new PlanoInexistente(`catalogo respondeu HTTP ${status} para ${url}`);

  const texto = limparCabecalho(htmlParaTexto(corpo));

  if (corpo.length < 4096 || /Plano desconhecido/i.test(texto)) {
    throw new PlanoInexistente(`sem plano no catalogo do INE para ${url}`);
  }
  if (!/^\s*1\s*[.)]\s*Identifica/im.test(texto)) {
    throw new PlanoInexistente(`pagina do catalogo sem bloco "1. Identificacao" (${url})`);
  }

  const mTitulo = texto.match(/^Plano De Ensino:\s*(.+)$/im);
  log.debug(`catalogo ${url}: ${corpo.length}B html, ${texto.length} chars texto`);

  return { url, titulo: mTitulo ? mTitulo[1].trim() : 'Plano de Ensino', texto };
}
