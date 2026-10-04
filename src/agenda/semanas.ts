/** Conversao semana-do-semestre -> intervalo de datas. Sempre estimativa (§9). */

/**
 * Data LOCAL, nao UTC: prazo que fecha 23:59 em Florianopolis e 02:59 UTC do dia
 * seguinte — em UTC a entrega de hoje apareceria como de amanha.
 */
export function epochParaISO(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString('sv-SE');
}

export function isoParaEpoch(iso: string): number {
  return Math.floor(new Date(`${iso}T12:00:00-03:00`).getTime() / 1000);
}

export function hojeISO(): string {
  return new Date().toLocaleDateString('sv-SE');
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diffDias(a: string, b: string): number {
  const ms = new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

/** dd/mm a partir de ISO; com ano quando nao e o ano corrente. */
export function ddmm(iso: string): string {
  const [a, m, d] = iso.split('-');
  const anoAtual = new Date().toLocaleDateString('sv-SE').slice(0, 4);
  return a === anoAtual ? `${d}/${m}` : `${d}/${m}/${a.slice(2)}`;
}

/**
 * startdate + (n-1)*7 dias. Feriado e SECCOM deslocam o calendario real,
 * entao o resultado e sempre marcado como estimado por quem chama.
 */
export function semanaParaIntervalo(
  startdateEpoch: number,
  semana: number
): { inicio: string; fim: string; centro: string } {
  // aritmetica sobre data ISO local, sem misturar fuso com epoch
  const diaInicial = epochParaISO(startdateEpoch);
  const diaSemana = new Date(`${diaInicial}T12:00:00Z`).getUTCDay();
  const ateSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const inicio = somarDias(diaInicial, ateSegunda + (semana - 1) * 7);
  return { inicio, fim: somarDias(inicio, 6), centro: somarDias(inicio, 3) };
}

const MESES: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};

/**
 * Le "12/08/2026", "26/08/26" ou "12 de agosto" no NOME DE SECAO do curso
 * (fonte 6). Nao roda sobre corpo de PDF: la "Aulas 13/14" viraria 13/04 (§8.2).
 */
export function dataEmNomeDeSecao(nome: string, anoPadrao: number): string | null {
  const m1 = nome.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
  if (m1) {
    const dia = Number(m1[1]);
    const mes = Number(m1[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      let ano = anoPadrao;
      if (m1[3]) ano = m1[3].length === 2 ? 2000 + Number(m1[3]) : Number(m1[3]);
      return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
  }
  const m2 = nome.match(/(\d{1,2})\s+de\s+([a-zç]{3})/i);
  if (m2) {
    const mes = MESES[m2[2].toLowerCase()];
    if (mes) return `${anoPadrao}-${mes}-${String(Number(m2[1])).padStart(2, '0')}`;
  }
  return null;
}
