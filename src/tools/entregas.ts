import { z } from 'zod';
import { resolverCursos } from '../moodle/cursos';
import { situacaoEntregas, Entrega, Situacao } from '../moodle/entregas';
import { ddmm, hojeISO, diffDias } from '../agenda/semanas';
import { colunas, blocos, truncar, marcarCorte, json } from '../render/text';
import { Ferramenta, FORMATO, REFRESH } from './tipos';

// 'pendente' (existe registro vazio) e 'nao_iniciado' (nem registro ha) sao a
// mesma coisa para quem pergunta: nao entreguei. A distincao fica no formato json.
const ROTULO: Record<Situacao, string> = {
  entregue: 'ENTREGUE',
  em_andamento: 'RASCUNHO NAO ENVIADO',
  pendente: 'NAO ENTREGUE',
  nao_iniciado: 'NAO ENTREGUE',
  desconhecido: '?',
};

function marca(e: Entrega, hoje: string): string {
  if (e.situacao === 'entregue') return 'ok';
  if (!e.prazo) return ' ';
  const faltam = diffDias(hoje, e.prazo);
  if (faltam < 0) return '!!';
  return faltam <= 7 ? '!' : ' ';
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export const entregas: Ferramenta = {
  nome: 'entregas',
  descricao: 'Ja entreguei? Situacao de tarefas e questionarios: entregue, pendente, quando.',
  schema: {
    disciplina: z.string().optional().describe('ex INE5617'),
    atividade: z.string().optional().describe('filtra pelo nome'),
    situacao: z.enum(['pendente', 'entregue', 'todas']).default('todas'),
    limite: z.number().int().min(1).max(60).default(25),
    refresh: REFRESH,
    formato: FORMATO,
  },
  async executar(args) {
    const cursos = await resolverCursos(args.disciplina, args.refresh === true);
    let lista = await situacaoEntregas(cursos, { refresh: args.refresh === true });

    if (args.atividade) {
      const alvo = normalizar(String(args.atividade));
      const termos = alvo.split(/\s+/).filter(Boolean);
      lista = lista.filter((e) => {
        const n = normalizar(e.titulo);
        return termos.every((t) => n.includes(t));
      });
    }

    if (args.situacao === 'pendente') {
      lista = lista.filter((e) => e.situacao !== 'entregue');
    } else if (args.situacao === 'entregue') {
      lista = lista.filter((e) => e.situacao === 'entregue');
    }

    if (args.formato === 'json') return json(lista);

    if (lista.length === 0) {
      return args.atividade
        ? `nenhuma tarefa ou questionario com "${args.atividade}"` +
            (args.disciplina ? ` em ${String(args.disciplina).toUpperCase()}` : '') + '.'
        : 'nenhuma tarefa ou questionario no semestre.';
    }

    const limite = args.limite ?? 25;
    const mostrados = lista.slice(0, limite);
    const hoje = hojeISO();

    const partes: string[] = [];
    let cursoAtual = '';
    const linhas: string[][] = [];
    const despejar = () => {
      if (linhas.length) {
        partes.push(colunas(linhas, ' '));
        linhas.length = 0;
      }
    };

    for (const e of mostrados) {
      if (e.codigo !== cursoAtual) {
        despejar();
        cursoAtual = e.codigo;
        partes.push(e.codigo);
      }
      const detalhe: string[] = [];
      if (e.situacao === 'entregue' && e.quando) detalhe.push(`em ${ddmm(e.quando)}`);
      if (e.atrasado) detalhe.push('COM ATRASO');
      if (e.nota) detalhe.push(`nota ${e.nota}`);
      if (e.correcao) detalhe.push(e.correcao);
      if (e.situacao !== 'entregue' && e.prazo) {
        const faltam = diffDias(hoje, e.prazo);
        detalhe.push(faltam < 0 ? `venceu ha ${-faltam}d` : `faltam ${faltam}d`);
      }
      linhas.push([
        `  ${marca(e, hoje)}`,
        e.prazo ? ddmm(e.prazo) : '  -  ',
        truncar(e.titulo, 44),
        e.tipo,
        ROTULO[e.situacao],
        detalhe.join(', '),
      ]);
    }
    despejar();

    const corte = marcarCorte(lista.length, mostrados.length, `limite=${Math.min(60, lista.length)}`);
    return blocos(`ENTREGAS (${lista.length})`, ...partes, corte);
  },
};
