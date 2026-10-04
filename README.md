# moodle-mcp

Servidor MCP local para conversar com o Moodle UFSC. Responde "o que tenho essa
semana", "o que vale nota", "o que o professor avisou" e lê slides sob demanda —
sem abrir o navegador.

Somente leitura: entregar trabalho, postar em fórum e responder quiz são
bloqueados por allowlist antes de a requisição ser montada.

## Instalação

```bash
npm install
npm run build
cp .env.example .env     # preencha MOODLE_TOKEN
node dist/index.js doctor
```

O token sai de **Moodle → Preferências → Chaves de segurança** (serviço
`moodle_mobile_app`).

Requer Node ≥ 22 (testado em 24.21 LTS) e `poppler-utils` (`pdftotext`).

## Registrar num agente

```bash
node dist/index.js install            # lista os agentes detectados na máquina
node dist/index.js install claude     # Claude Code   (~/.claude.json)
node dist/index.js install opencode   # OpenCode      (~/.config/opencode/opencode.json)
node dist/index.js install codex      # Codex         (~/.codex/config.toml)
node dist/index.js install cursor     # Cursor        (~/.cursor/mcp.json)
node dist/index.js install windsurf   # Windsurf
node dist/index.js install vscode     # VS Code       (.vscode/mcp.json)
node dist/index.js install gemini     # Gemini CLI    (~/.gemini/settings.json)
```

O arquivo alvo é mesclado, nunca sobrescrito, e uma cópia `.bak` é guardada.

| opção | efeito |
|---|---|
| `--projeto <dir>` | escreve config de projeto em vez de global |
| `--com-env` | inlina `MOODLE_TOKEN` na config do agente |
| `--nome <nome>` | nome do servidor (padrão `moodle`) |

Por padrão **o token não vai para a config do agente**: o servidor lê o `.env`
do próprio diretório. O caminho absoluto do `node` que rodou o `install` é
gravado na config, porque o agente herda outro `PATH` e `better-sqlite3` é
módulo nativo.

Para remover: `node dist/index.js uninstall <alvo>`.
Para copiar à mão: `node dist/index.js config`.

## As dez tools

| tool | para quê |
|---|---|
| `agenda` | prazos, provas, entregas e pendências |
| `entregas` | já entreguei? situação de tarefas e questionários |
| `disciplinas` | lista do semestre; com código, detalha uma |
| `plano` | documento-mestre, inteiro ou por seção |
| `salvar_ficha` | grava a ficha destilada (avaliações, pesos, datas) |
| `materiais` | lista materiais, sem o conteúdo |
| `ler` | PDF/link/enunciado → texto, paginado |
| `avisos` | avisos dos professores e fóruns |
| `notas` | notas, o que falta e a média parcial |
| `buscar` | full-text no material já lido |

Toda tool aceita `refresh=true`; as de dados aceitam `formato="json"`.

### Já entreguei?

`entregas` responde por tarefa **e** por questionário, que são APIs diferentes no
Moodle (`mod_assign_get_submission_status` e `mod_quiz_get_user_attempts`):

```
entregas(atividade="trabalho pratico 1")   -> uma linha, ~20 tokens
entregas(situacao="pendente")              -> só o que falta
entregas(disciplina="INE5680")             -> tudo da disciplina
```

Distingue entregue, rascunho não enviado e não entregue; marca `COM ATRASO`
quando o envio passou do prazo e `!!` quando o prazo venceu sem envio.
Questionário finalizado sai da agenda sozinho.

### O ciclo da ficha

Uma vez por disciplina por semestre, o agente destila o plano de ensino numa
ficha de ~200 tokens. Daí em diante `agenda` e `notas` sabem os pesos sem reler
nada:

```
disciplinas()                     -> ficha:-
plano("INE5617","avaliacao")      -> ~400 tokens
plano("INE5617","cronograma")     -> ~150 tokens
salvar_ficha("INE5617", {...})    -> grava e valida
```

Quem destila é o agente com quem você já está conversando: o servidor não chama
LLM nenhum. A gravação valida soma de pesos, datas ISO dentro do semestre e
siglas únicas — ficha torta não entra.

### Quando o plano muda no meio do semestre

`plano` revalida por hash a cada chamada (~20 KB, ~200 ms, zero token). Mudou
seção de avaliação, recuperação ou cronograma:

1. a ficha vira `desatualizada` e a agenda abre com alerta;
2. `plano(codigo,"mudancas")` mostra só o diff (~100 tokens);
3. a data antiga fica em quarentena, visível ao lado da nova, até você
   confirmar com um novo `salvar_ficha`.

## Onde mora o documento-mestre

Três vias, nesta ordem (§8 do PLANO.md):

1. módulo no Moodle (`url` → catálogo do INE, ou `resource` → PDF);
2. URL derivada do `idnumber` da turma no catálogo do INE;
3. ausente — responde uma linha dizendo que não achou, sem inventar.

Nem toda disciplina tem plano de ensino: CAD5103 tem um *cronograma de aulas*
que cumpre o mesmo papel, sem pesos. A ficha aceita `pesos_conhecidos: false` e
`notas` não inventa parcial.

## Comandos de manutenção

```bash
node dist/index.js doctor              # token, rede, pdftotext, banco
node dist/index.js tools               # lista as tools
node dist/index.js run agenda '{"dias":7}'    # testa uma tool no terminal
node dist/index.js run entregas '{"atividade":"trabalho pratico 1"}'
```

`run` imprime o custo em tokens da resposta no stderr — é como se mede o
orçamento da §5.7.

## Arquivos

```
dados.db      SQLite: cursos, itens, fichas, prazos, cache, FTS5
cache/files/  PDFs baixados, nomeados pelo sha256
cache/text/   texto extraído, vinculado ao sha do arquivo
.env          token (modo 600, fora do git)
```

`.env` e `cache/` estão no `.gitignore`: material de disciplina e nomes de
colegas em fórum não vão para repositório.
