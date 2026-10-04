import { z } from 'zod';
import { listarCursos, acharCurso } from '../moodle/cursos';
import { conteudoBruto } from '../moodle/conteudo';
import { lerFicha, fichasSalvas } from '../planos/fichas';
import { montarAgenda } from '../agenda/unify';
import { listarAvisos } from '../moodle/foruns';
import { htmlParaLinha } from '../extract/html';
import { blocosDeTexto } from '../moodle/textos';
import { colunas, blocos, truncar, json } from '../render/text';
import { ddmm, epochParaISO } from '../agenda/semanas';
import { Ferramenta, FORMATO, REFRESH } from './tipos';

export const disciplinas: Ferramenta = {
  nome: 'disciplinas',
  descricao: 'Lista as disciplinas do semestre; com codigo, detalha uma.',
  schema: {
    codigo: z.string().optional().describe('ex INE5617'),
    refresh: REFRESH,
    formato: FORMATO,
  },
  async executar(args) {
    const refresh = args.refresh === true;

    if (!args.codigo) {
      const cursos = await listarCursos(refresh);
      const fichas = fichasSalvas();
      if (args.formato === 'json') {
        return json(
          cursos.map((c) => ({
            ...c,
            ficha: fichas.get(c.codigo)?.status ?? null,
            horario: fichas.get(c.codigo)?.ficha.horario ?? null,
          }))
        );
      }
      const linhas = cursos.map((c) => {
        const f = fichas.get(c.codigo);
        return [
          c.codigo,
          truncar(c.nome, 38),
          truncar(c.professor || '-', 26),
          truncar(f?.ficha.horario || '-', 24),
          `ficha:${f ? (f.status === 'ok' ? 'ok' : 'desatualizada') : '-'}`,
        ];
      });
      return blocos(`${cursos.length} disciplinas em ${cursos[0]?.semestre ?? ''}`, colunas(linhas));
    }

    const curso = await acharCurso(args.codigo, refresh);
    const salva = lerFicha(curso.codigo);
    const secoes = await conteudoBruto(curso, refresh);
    const agenda = await montarAgenda({ dias: 45, disciplina: curso.codigo, refresh: false });
    const desde = Math.floor(Date.now() / 1000) - 21 * 86400;
    const avisos = await listarAvisos([curso], desde, false).catch(() => []);
    const quadros = await blocosDeTexto(curso.codigo, refresh).catch(() => []);

    if (args.formato === 'json') {
      return json({
        curso,
        ficha: salva?.ficha ?? null,
        ficha_status: salva?.status ?? null,
        proximos: agenda.itens,
        secoes: secoes.map((s) => htmlParaLinha(s.name)),
        quadros,
        avisos: avisos.slice(0, 3),
      });
    }

    const partes: string[] = [];
    partes.push(`${curso.codigo} ${curso.nome}`);
    partes.push(`professor ${curso.professor || '-'}  turma ${curso.turma}`);

    if (salva) {
      const f = salva.ficha;
      if (f.horario) partes.push(`horario ${f.horario}`);
      partes.push('');
      partes.push(`FICHA ${salva.status === 'ok' ? '' : '(DESATUALIZADA — o documento mudou)'}`.trim());
      partes.push(`  formula ${f.formula || (f.pesos_conhecidos ? '-' : 'pesos nao informados no documento')}`);
      const av = (f.avaliacoes || []).map((a) => [
        `  ${a.sigla}`,
        truncar(a.nome, 42),
        a.peso == null ? '-' : `${Math.round(a.peso * 100)}%`,
        a.data ? ddmm(a.data) : '',
        a.grupo ? 'grupo' : '',
        a.composicao ? truncar(a.composicao, 30) : '',
      ]);
      if (av.length) partes.push(colunas(av));
      if (f.nao_vale_nota?.length) partes.push(`  nao vale nota: ${f.nao_vale_nota.join('; ')}`);
      if (f.recuperacao?.regra) {
        partes.push(`  recuperacao: ${f.recuperacao.regra}${f.recuperacao.data ? ` em ${ddmm(f.recuperacao.data)}` : ''}`);
      }
      if (f.frequencia) partes.push(`  frequencia: ${f.frequencia}`);
      if (f.fonte) partes.push(`  fonte: ${f.fonte}`);
    } else {
      partes.push('');
      partes.push(`FICHA nao extraida — use plano("${curso.codigo}","avaliacao") e salvar_ficha`);
    }

    partes.push('');
    partes.push('PROXIMOS 45 DIAS');
    if (agenda.itens.length === 0) partes.push('  nada');
    else {
      partes.push(
        colunas(
          agenda.itens
            .slice(0, 8)
            .map((c) => [
              `  ${c.confianca === 'estimada' ? '~' : ''}${ddmm(c.data)}`,
              truncar(c.titulo, 46),
              c.status === 'pendente' ? 'PENDENTE' : c.status === 'entregue' ? 'entregue' : '',
            ])
        )
      );
    }

    if (avisos.length) {
      partes.push('');
      partes.push('ULTIMOS AVISOS');
      partes.push(
        colunas(
          avisos.slice(0, 3).map((a) => [
            `  ${ddmm(epochParaISO(a.epoch))}`,
            truncar(a.titulo, 60),
          ])
        )
      );
    }

    if (quadros.length) {
      partes.push('');
      partes.push(`QUADROS DO PROFESSOR (${quadros.length}) — datas daqui nao estao no calendario`);
      for (const q of quadros.slice(0, 6)) {
        partes.push(`  ${q.id}  ${truncar(q.texto, 220)}`);
      }
      if (quadros.length > 6) partes.push(`  ... +${quadros.length - 6} (use materiais tipo="texto")`);
    }

    partes.push('');
    partes.push(`SECOES (${secoes.length})`);
    partes.push(
      secoes
        .map((s) => `  ${truncar(htmlParaLinha(s.name), 60)}`)
        .join('\n')
    );

    return blocos(...partes);
  },
};
