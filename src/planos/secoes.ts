export type SecaoCanonica =
  | 'identificacao' | 'ementa' | 'objetivos' | 'conteudo' | 'metodologia'
  | 'avaliacao' | 'recuperacao' | 'cronograma' | 'bibliografia';

export const SECOES_CANONICAS: SecaoCanonica[] = [
  'identificacao', 'ementa', 'objetivos', 'conteudo', 'metodologia',
  'avaliacao', 'recuperacao', 'cronograma', 'bibliografia',
];

export interface Secao {
  rotulo: string;
  canonica: SecaoCanonica | null;
  texto: string;
}

export interface Seccionamento {
  formato: 'arabico' | 'romano' | 'nenhum';
  secoes: Secao[];
  preambulo: string;
}

/**
 * A ordem importa:
 * - "Avaliacao de Recuperacao" e "Nova Avaliacao" sao recuperacao, nao avaliacao;
 * - "Conteudo Programatico e Cronograma" (PSI7002) e onde moram as datas;
 * - \bementa\b com fronteira: "Bibliografia ComplEMENTAr" nao e ementa.
 */
const MAPA: Array<[RegExp, SecaoCanonica]> = [
  [/recupera|nova avalia/i, 'recuperacao'],
  [/identifica/i, 'identificacao'],
  [/bibliografia|refer[eê]ncia/i, 'bibliografia'],
  [/cronograma|calend[aá]rio|planejamento das aulas|aulas previstas/i, 'cronograma'],
  [/\bementa\b/i, 'ementa'],
  [/objetivo/i, 'objetivos'],
  [/conte[uú]do|program[aá]tico/i, 'conteudo'],
  [/metodologia|m[eé]todo/i, 'metodologia'],
  [/avalia|sistema de nota/i, 'avaliacao'],
];

export function canonizar(rotulo: string): SecaoCanonica | null {
  for (const [re, canon] of MAPA) if (re.test(rotulo)) return canon;
  return null;
}

const ROMANOS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

function valorRomano(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMANOS[s[i]];
    const prox = ROMANOS[s[i + 1]];
    total += prox && prox > v ? -v : v;
  }
  return total;
}

function tituloPlausivel(t: string): boolean {
  const limpo = t.trim();
  if (limpo.length < 3 || limpo.length > 90) return false;
  if (/[.;]$/.test(limpo)) return false;
  // titulo nao costuma ser frase inteira com verbo conjugado e virgulas
  if ((limpo.match(/,/g) || []).length > 2) return false;
  return true;
}

interface Marcador {
  linha: number;
  numero: number;
  rotulo: string;
}

function acharMarcadores(linhas: string[], formato: 'arabico' | 'romano'): Marcador[] {
  const re =
    formato === 'arabico'
      ? /^(\d{1,2})\s*[.)\-]\s+(.+)$/
      : /^([IVXLC]{1,6})\s*[.)\-]\s+(.+)$/;
  const marcadores: Marcador[] = [];
  let esperado = 1;
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].trim().match(re);
    if (!m) continue;
    const numero = formato === 'arabico' ? Number(m[1]) : valorRomano(m[1]);
    // sequencia monotonica: evita confundir item de lista numerada com secao
    if (numero !== esperado || !tituloPlausivel(m[2])) continue;
    marcadores.push({ linha: i, numero, rotulo: m[2].trim() });
    esperado = numero + 1;
  }
  return marcadores;
}

/**
 * Tres formatos (§8.1): arabico numerado (catalogo INE), romano (PDFs) e
 * "nenhum" (cronograma em tabela). Quando nenhum corte pega, quem chama avisa
 * que nao seccionou em vez de devolver o documento inteiro por engano.
 */
export function seccionar(texto: string): Seccionamento {
  const linhas = texto.split('\n');
  let melhor: Seccionamento | null = null;
  let melhorScore = 0;

  for (const formato of ['arabico', 'romano'] as const) {
    const marcadores = acharMarcadores(linhas, formato);
    if (marcadores.length < 3) continue;

    const secoes: Secao[] = marcadores.map((m, i) => {
      const fim = i + 1 < marcadores.length ? marcadores[i + 1].linha : linhas.length;
      return {
        rotulo: m.rotulo,
        canonica: canonizar(m.rotulo),
        texto: linhas.slice(m.linha + 1, fim).join('\n').trim(),
      };
    });

    // Um plano de verdade tem secoes reconheciveis. Uma lista numerada de
    // topicos (CAD5103: PLANEJAMENTO/ORGANIZACAO/DIRECAO/CONTROLE) nao tem —
    // e seccionar por ela seria mentir sobre a estrutura do documento.
    const score = secoes.filter((s) => s.canonica).length;
    if (score >= 2 && score > melhorScore) {
      melhorScore = score;
      melhor = {
        formato,
        secoes,
        preambulo: linhas.slice(0, marcadores[0].linha).join('\n').trim(),
      };
    }
  }

  return melhor ?? { formato: 'nenhum', secoes: [], preambulo: '' };
}

export function acharSecao(s: Seccionamento, alvo: SecaoCanonica): Secao[] {
  return s.secoes.filter((x) => x.canonica === alvo);
}
