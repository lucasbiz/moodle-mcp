#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { criarServidor, FERRAMENTAS } from './server';
import { carregarConfig } from './config';
import { log, redigir } from './logger';
import { ALVOS, Alvo, instalar, desinstalar, detectar, snippets } from './cli/install';
import { doctor } from './cli/doctor';

const USO = `moodle-mcp — servidor MCP do Moodle UFSC (somente leitura)

  moodle-mcp                          inicia o servidor MCP (stdio) — e o que o agente chama
  moodle-mcp install [alvo]           registra no agente: ${ALVOS.join(', ')}
  moodle-mcp uninstall <alvo>         remove o registro
  moodle-mcp config                   imprime os snippets de configuracao
  moodle-mcp doctor                   verifica token, rede, pdftotext e banco
  moodle-mcp tools                    lista as tools e o custo do bloco de definicoes
  moodle-mcp run <tool> [json]        executa uma tool no terminal (teste sem agente)

opcoes de install:
  --projeto <dir>   escreve config de projeto em vez de global
  --com-env         inlina MOODLE_TOKEN na config do agente (padrao: nao, o servidor le o proprio .env)
  --nome <nome>     nome do servidor (padrao: moodle)
`;

function flag(argv: string[], nome: string): string | undefined {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const comando = argv[0];

  if (!comando) {
    carregarConfig();
    const server = criarServidor();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info('moodle-mcp no ar (stdio)');
    return;
  }

  const op = {
    projeto: flag(argv, '--projeto'),
    comEnv: argv.includes('--com-env'),
    nome: flag(argv, '--nome'),
  };

  switch (comando) {
    case 'install': {
      const alvo = argv[1] as Alvo | undefined;
      if (!alvo) {
        const achados = detectar();
        process.stdout.write('agentes nesta maquina:\n');
        for (const a of achados) {
          process.stdout.write(`  ${a.presente ? '*' : ' '} ${a.alvo.padEnd(9)} ${a.arquivo}\n`);
        }
        process.stdout.write(`\ninstale com: moodle-mcp install <alvo>\n`);
        return;
      }
      if (!ALVOS.includes(alvo)) throw new Error(`alvo desconhecido: ${alvo}. Use ${ALVOS.join(', ')}`);
      const r = instalar(alvo, op);
      process.stdout.write(`${r.acao} ${r.arquivo}\nreinicie o ${alvo} para carregar o servidor "moodle".\n`);
      return;
    }
    case 'uninstall': {
      const alvo = argv[1] as Alvo;
      if (!ALVOS.includes(alvo)) throw new Error(`alvo desconhecido: ${alvo}`);
      process.stdout.write(desinstalar(alvo, op) + '\n');
      return;
    }
    case 'config':
      process.stdout.write(snippets(op) + '\n');
      return;
    case 'doctor':
      process.exitCode = (await doctor()) > 0 ? 1 : 0;
      return;
    case 'tools': {
      const linhas = FERRAMENTAS.map((f) => `  ${f.nome.padEnd(14)} ${f.descricao}`);
      const bloco = FERRAMENTAS.map((f) => f.nome + f.descricao + JSON.stringify(Object.keys(f.schema))).join('');
      process.stdout.write(
        `${FERRAMENTAS.length} tools:\n${linhas.join('\n')}\n\n` +
          `~${Math.round(bloco.length / 4)} tokens de nome+descricao (alvo do plano: <= 700 com schemas)\n`
      );
      return;
    }
    case 'run': {
      const nome = argv[1];
      const f = FERRAMENTAS.find((x) => x.nome === nome);
      if (!f) throw new Error(`tool desconhecida: ${nome}. Use: ${FERRAMENTAS.map((x) => x.nome).join(', ')}`);
      const bruto = argv.slice(2).filter((a) => !a.startsWith('--')).join(' ') || '{}';
      const args = JSON.parse(bruto);
      const saida = await f.executar(args);
      process.stdout.write(saida + '\n');
      process.stderr.write(`\n[${saida.length} chars ~${Math.round(saida.length / 4)} tokens]\n`);
      return;
    }
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(USO);
      return;
    default:
      process.stdout.write(USO);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write(`erro: ${redigir((e as Error).message || String(e))}\n`);
  process.exit(1);
});
