import { z } from 'zod';
import { resolverDocumento, ultimaMudanca, DocumentoAusente } from '../planos/resolver';
import { SecaoCanonica } from '../planos/secoes';
import { blocos, json, truncar } from '../render/text';
import { Ferramenta, FORMATO, REFRESH } from './tipos';

const ORIGENS: Record<string, string> = {
  catalogo: 'catalogo INE',
  pdf_moodle: 'PDF no Moodle',
  pdf_externo: 'PDF externo',
  html_externo: 'pagina externa',
};

export const plano: Ferramenta = {
  nome: 'plano',
  descricao:
    'Documento-mestre da disciplina (plano de ensino ou cronograma), inteiro ou por secao.',
  schema: {
    codigo: z.string().describe('ex INE5617'),
    secao: z
      .enum(['identificacao', 'ementa', 'objetivos', 'conteudo', 'metodologia',
             'avaliacao', 'recuperacao', 'cronograma', 'bibliografia', 'mudancas'])
      .optional()
      .describe('mudancas = diff do documento'),
    refresh: REFRESH,
    formato: FORMATO,
  },
  async executar(args) {
    const codigo = String(args.codigo).toUpperCase();

    if (args.secao === 'mudancas') {
      const m = ultimaMudanca(codigo);
      if (args.formato === 'json') return json(m);
      if (!m) return `${codigo}: nenhuma mudanca registrada no documento-mestre.`;
      const partes = [
        `${codigo} MUDANCAS no documento-mestre (detectado ${m.vistoEm.slice(0, 10)})`,
        m.critica ? '! toca avaliacao/recuperacao/cronograma — ficha marcada desatualizada' : '',
        '',
      ];
      for (const s of m.secoes) {
        partes.push(`[${s.rotulo}]`);
        for (const l of s.removidas.slice(0, 8)) partes.push(`  - ${truncar(l, 160)}`);
        for (const l of s.adicionadas.slice(0, 8)) partes.push(`  + ${truncar(l, 160)}`);
        const resto = s.removidas.length + s.adicionadas.length - Math.min(8, s.removidas.length) - Math.min(8, s.adicionadas.length);
        if (resto > 0) partes.push(`  ... +${resto} linhas`);
        partes.push('');
      }
      partes.push(`corrija a ficha e chame salvar_ficha("${codigo}", ...) para fechar a quarentena`);
      return blocos(...partes);
    }

    let doc;
    try {
      // sempre revalida: e a tool onde frescura importa e o custo em token e zero (§8.4)
      doc = await resolverDocumento(codigo, { refresh: args.refresh === true, revalidar: true });
    } catch (e) {
      if (e instanceof DocumentoAusente) return e.message;
      throw e;
    }

    if (args.formato === 'json') {
      return json({
        codigo: doc.codigo,
        origem: doc.origem,
        url: doc.url,
        sha: doc.sha.slice(0, 12),
        formato_secoes: doc.seccionamento.formato,
        secoes: doc.seccionamento.secoes,
        mudanca: doc.mudanca,
        texto: args.secao ? undefined : doc.texto,
      });
    }

    const cabecalho: string[] = [
      `${doc.codigo} ${doc.titulo} [${ORIGENS[doc.origem] || doc.origem}]`,
    ];
    if (doc.mudanca) {
      cabecalho.push(
        `! documento mudou desde a ultima leitura (${doc.mudanca.secoes.map((s) => s.rotulo).join(', ')})` +
          `${doc.mudanca.critica ? ' — ficha desatualizada' : ''}; use secao="mudancas"`
      );
    }

    if (!args.secao) {
      if (doc.seccionamento.formato === 'nenhum') {
        cabecalho.push('(nao seccionavel: documento devolvido inteiro)');
      }
      return blocos(...cabecalho, '', doc.texto);
    }

    if (doc.seccionamento.formato === 'nenhum') {
      return blocos(
        ...cabecalho,
        '',
        `nao foi possivel seccionar este documento (formato de tabela/livre), entao secao="${args.secao}" nao se aplica.`,
        `use plano("${codigo}") sem secao para ler o documento inteiro (${doc.texto.length} chars).`
      );
    }

    const alvo = args.secao as SecaoCanonica;
    const achadas = doc.seccionamento.secoes.filter((s) => s.canonica === alvo);
    if (achadas.length === 0) {
      const disponiveis = doc.seccionamento.secoes
        .map((s) => s.canonica || `"${s.rotulo}"`)
        .join(', ');
      return blocos(
        ...cabecalho,
        '',
        `secao "${args.secao}" nao encontrada. Disponiveis: ${disponiveis}`
      );
    }

    return blocos(
      ...cabecalho,
      '',
      ...achadas.map((s) => `[${s.rotulo}]\n${s.texto}`)
    );
  },
};
