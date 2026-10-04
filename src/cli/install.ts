import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { raizProjeto, carregarConfig } from '../config';

export type Alvo =
  | 'claude' | 'opencode' | 'codex' | 'cursor' | 'windsurf' | 'vscode' | 'gemini' | 'print';

export const ALVOS: Alvo[] = ['claude', 'opencode', 'codex', 'cursor', 'windsurf', 'vscode', 'gemini'];

const NOME_SERVIDOR = 'moodle';

function entrada(): string {
  return path.join(raizProjeto(), 'dist', 'index.js');
}

/**
 * Caminho absoluto do node que rodou o install. O agente MCP herda o PATH dele,
 * que pode apontar para um node velho (better-sqlite3 e modulo nativo).
 */
function interpretador(): string {
  return process.env.MOODLE_MCP_NODE || process.execPath;
}

interface Opcoes {
  projeto?: string;
  comEnv?: boolean;
  nome?: string;
}

/**
 * Por padrao o token NAO vai para a config do agente: o servidor le o .env
 * do proprio diretorio. --com-env inlina as variaveis para quem prefere assim.
 */
function blocoEnv(comEnv: boolean): Record<string, string> | undefined {
  if (!comEnv) return undefined;
  const c = carregarConfig();
  return {
    MOODLE_URL: c.moodleUrl,
    MOODLE_TOKEN: c.token,
    SEMESTRE: c.semestreAuto ? 'auto' : c.semestre,
  };
}

function caminhoAlvo(alvo: Alvo, op: Opcoes): string {
  const casa = os.homedir();
  const proj = op.projeto ? path.resolve(op.projeto) : null;
  switch (alvo) {
    case 'claude':
      return proj ? path.join(proj, '.mcp.json') : path.join(casa, '.claude.json');
    case 'opencode':
      return proj ? path.join(proj, 'opencode.json') : path.join(casa, '.config', 'opencode', 'opencode.json');
    case 'codex':
      return path.join(casa, '.codex', 'config.toml');
    case 'cursor':
      return proj ? path.join(proj, '.cursor', 'mcp.json') : path.join(casa, '.cursor', 'mcp.json');
    case 'windsurf':
      return path.join(casa, '.codeium', 'windsurf', 'mcp_config.json');
    case 'vscode':
      return path.join(proj ?? process.cwd(), '.vscode', 'mcp.json');
    case 'gemini':
      return path.join(casa, '.gemini', 'settings.json');
    default:
      return '';
  }
}

function lerJson(arquivo: string): Record<string, any> {
  if (!fs.existsSync(arquivo)) return {};
  const bruto = fs.readFileSync(arquivo, 'utf8').trim();
  if (!bruto) return {};
  try {
    return JSON.parse(bruto);
  } catch (e) {
    throw new Error(`${arquivo} nao e JSON valido (${(e as Error).message}); corrija antes de instalar`);
  }
}

function gravarJson(arquivo: string, dados: unknown): void {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, `${arquivo}.bak`);
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2) + '\n', 'utf8');
}

export function configPadrao(op: Opcoes = {}): Record<string, unknown> {
  const env = blocoEnv(op.comEnv === true);
  return { command: interpretador(), args: [entrada()], ...(env ? { env } : {}) };
}

function instalarCodex(arquivo: string, nome: string, op: Opcoes): void {
  const env = blocoEnv(op.comEnv === true);
  const linhas = [
    `[mcp_servers.${nome}]`,
    `command = "${interpretador()}"`,
    `args = ["${entrada()}"]`,
    ...(env ? [`env = { ${Object.entries(env).map(([k, v]) => `${k} = "${v}"`).join(', ')} }`] : []),
  ];
  const bloco = linhas.join('\n');

  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  let conteudo = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '';
  if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, `${arquivo}.bak`);

  const re = new RegExp(`\\[mcp_servers\\.${nome}\\][\\s\\S]*?(?=\\n\\[|$)`, 'g');
  conteudo = re.test(conteudo)
    ? conteudo.replace(re, bloco + '\n')
    : (conteudo.trimEnd() + '\n\n' + bloco + '\n').trimStart();

  fs.writeFileSync(arquivo, conteudo, 'utf8');
}

export interface Resultado {
  alvo: Alvo;
  arquivo: string;
  acao: 'criado' | 'atualizado';
}

/**
 * ~/.claude.json guarda estado de sessao junto com a config. Reescrever 70 KB
 * de JSON para inserir 3 linhas e risco desnecessario quando o proprio CLI
 * sabe fazer isso — so cai no merge manual se o `claude` nao estiver instalado.
 */
function tentarClaudeCli(nome: string, op: Opcoes): boolean {
  try {
    const escopo = op.projeto ? 'project' : 'user';
    const json = JSON.stringify({ type: 'stdio', ...configPadrao(op) });
    execFileSync('claude', ['mcp', 'add-json', '--scope', escopo, nome, json], {
      stdio: 'pipe',
      cwd: op.projeto ? path.resolve(op.projeto) : undefined,
    });
    return true;
  } catch {
    return false;
  }
}

export function instalar(alvo: Alvo, op: Opcoes = {}): Resultado {
  const nome = op.nome || NOME_SERVIDOR;
  const arquivo = caminhoAlvo(alvo, op);
  const existia = fs.existsSync(arquivo);

  if (alvo === 'claude' && !op.projeto && tentarClaudeCli(nome, op)) {
    return { alvo, arquivo: `${arquivo} (via claude mcp add-json)`, acao: 'atualizado' };
  }

  if (alvo === 'codex') {
    instalarCodex(arquivo, nome, op);
    return { alvo, arquivo, acao: existia ? 'atualizado' : 'criado' };
  }

  const cfg = lerJson(arquivo);

  if (alvo === 'opencode') {
    cfg.$schema = cfg.$schema || 'https://opencode.ai/config.json';
    cfg.mcp = cfg.mcp || {};
    const env = blocoEnv(op.comEnv === true);
    cfg.mcp[nome] = {
      type: 'local',
      command: [interpretador(), entrada()],
      enabled: true,
      ...(env ? { environment: env } : {}),
    };
  } else if (alvo === 'vscode') {
    cfg.servers = cfg.servers || {};
    cfg.servers[nome] = { type: 'stdio', ...configPadrao(op) };
  } else {
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers[nome] = configPadrao(op);
  }

  gravarJson(arquivo, cfg);
  return { alvo, arquivo, acao: existia ? 'atualizado' : 'criado' };
}

export function desinstalar(alvo: Alvo, op: Opcoes = {}): string {
  const nome = op.nome || NOME_SERVIDOR;
  const arquivo = caminhoAlvo(alvo, op);
  if (!fs.existsSync(arquivo)) return `${arquivo} nao existe`;

  if (alvo === 'codex') {
    let conteudo = fs.readFileSync(arquivo, 'utf8');
    fs.copyFileSync(arquivo, `${arquivo}.bak`);
    conteudo = conteudo.replace(new RegExp(`\\[mcp_servers\\.${nome}\\][\\s\\S]*?(?=\\n\\[|$)`, 'g'), '');
    fs.writeFileSync(arquivo, conteudo.replace(/\n{3,}/g, '\n\n'), 'utf8');
    return `removido de ${arquivo}`;
  }

  const cfg = lerJson(arquivo);
  const secao = alvo === 'opencode' ? 'mcp' : alvo === 'vscode' ? 'servers' : 'mcpServers';
  if (cfg[secao]?.[nome]) {
    delete cfg[secao][nome];
    gravarJson(arquivo, cfg);
    return `removido de ${arquivo}`;
  }
  return `${nome} nao estava em ${arquivo}`;
}

/** Quais agentes existem nesta maquina — para `install` sem argumento. */
export function detectar(): Array<{ alvo: Alvo; arquivo: string; presente: boolean }> {
  return ALVOS.map((alvo) => {
    const arquivo = caminhoAlvo(alvo, {});
    const dir = path.dirname(arquivo);
    return { alvo, arquivo, presente: fs.existsSync(arquivo) || fs.existsSync(dir) };
  });
}

export function snippets(op: Opcoes = {}): string {
  const nome = op.nome || NOME_SERVIDOR;
  const padrao = { mcpServers: { [nome]: configPadrao(op) } };
  return [
    '# Claude Code / Cursor / Windsurf / Gemini CLI  (~/.claude.json, .mcp.json, ...)',
    JSON.stringify(padrao, null, 2),
    '',
    '# OpenCode  (opencode.json)',
    JSON.stringify(
      { $schema: 'https://opencode.ai/config.json', mcp: { [nome]: { type: 'local', command: [interpretador(), entrada()], enabled: true } } },
      null,
      2
    ),
    '',
    '# VS Code  (.vscode/mcp.json)',
    JSON.stringify({ servers: { [nome]: { type: 'stdio', ...configPadrao(op) } } }, null, 2),
    '',
    '# Codex  (~/.codex/config.toml)',
    `[mcp_servers.${nome}]\ncommand = "${interpretador()}"\nargs = ["${entrada()}"]`,
  ].join('\n');
}
