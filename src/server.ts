import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ferramenta } from './tools/tipos';
import { agenda } from './tools/agenda';
import { disciplinas } from './tools/disciplinas';
import { plano } from './tools/plano';
import { salvar_ficha } from './tools/salvar_ficha';
import { materiais } from './tools/materiais';
import { ler } from './tools/ler';
import { avisos } from './tools/avisos';
import { notas } from './tools/notas';
import { buscar } from './tools/buscar';
import { entregas } from './tools/entregas';
import { limparExpirados } from './store/cache';
import { log, redigir } from './logger';

export const FERRAMENTAS: Ferramenta[] = [
  agenda, disciplinas, plano, salvar_ficha, materiais, ler, avisos, notas, buscar, entregas,
];

export function criarServidor(): McpServer {
  const server = new McpServer(
    { name: 'moodle', version: '1.0.0' },
    {
      instructions:
        'Moodle UFSC, somente leitura. Comece por agenda() ou disciplinas(). ' +
        'Disciplina e identificada pelo codigo (INE5617) e material por codigo/indice (INE5617/7). ' +
        'Quando disciplinas() mostrar ficha:-, leia plano(codigo,"avaliacao") e grave com salvar_ficha: ' +
        'a partir dai agenda e notas sabem os pesos sem reler o plano.',
    }
  );

  for (const f of FERRAMENTAS) {
    server.registerTool(
      f.nome,
      {
        description: f.descricao,
        inputSchema: f.schema,
        annotations: { readOnlyHint: f.nome !== 'salvar_ficha' },
      },
      async (args: unknown) => {
        const inicio = Date.now();
        try {
          const texto = await f.executar(args ?? {});
          log.debug(`tool ${f.nome} ${Date.now() - inicio}ms ${texto.length} chars`);
          return { content: [{ type: 'text' as const, text: texto }] };
        } catch (e) {
          const msg = redigir((e as Error).message || String(e));
          log.warn(`tool ${f.nome} falhou: ${msg}`);
          return { content: [{ type: 'text' as const, text: `erro: ${msg}` }], isError: true };
        }
      }
    );
  }

  try {
    limparExpirados();
  } catch (e) {
    log.debug('limpeza de cache falhou', e);
  }

  return server;
}
