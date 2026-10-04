# PLANO — `moodle-mcp`

Servidor MCP local para conversar com o Moodle UFSC. Projeto **autônomo**: não lê,
não escreve e não importa nada do `moodle-watcher`. Token próprio, banco próprio,
cliente HTTP próprio.

---

## 1. Objetivo

Não esquecer nada da vida acadêmica. O agente precisa responder, sem eu abrir o
Moodle:

- O que tenho pela frente (prazos, provas, entregas) e o que já entreguei.
- **O que vale nota e o que não vale**, com peso de cada avaliação — extraído dos
  planos de ensino.
- O que o professor avisou e o que mudou na disciplina.
- Quando eu pedir: ler um slide, um enunciado, um material específico.

### Princípio norteador: economia de tokens

Cada token que entra no contexto é pago em toda mensagem seguinte da conversa.
O servidor é projetado para que **a conversa típica custe algumas centenas de
tokens**, e não dezenas de milhares. Ler slides é exceção sob demanda, nunca
comportamento padrão.

Três consequências de projeto que atravessam o documento inteiro:

1. **O trabalho caro acontece uma vez e vira dado barato.** Um plano de ensino de
   12 mil caracteres é lido uma vez por semestre; o que sobra é uma ficha de ~200
   tokens consultada o resto do semestre (§7).
2. **Poucas ferramentas, descrições curtas.** A definição das tools é reenviada em
   toda requisição. 9 tools com descrição de uma linha custam ~600 tokens de
   overhead permanente; 20 tools verbosas custariam 4 mil (§5.1).
3. **Saída em texto, não em JSON.** JSON gasta 2–3× em chaves e pontuação para a
   mesma informação (§5.2).

---

## 2. Escopo

### Dentro

- Leitura de disciplinas, seções, materiais, prazos, avisos, notas e submissões
  do semestre corrente.
- Resolução e leitura de planos de ensino nas três formas em que aparecem (§8).
- Destilação persistente do plano em "ficha da disciplina" (§7).
- Download, cache e extração de texto de PDFs, sob demanda.
- Agenda unificada, cruzando Moodle + plano de ensino (§9).

### Fora

- **Qualquer escrita no Moodle.** Entregar trabalho, postar em fórum, responder
  quiz: bloqueado por allowlist (§12).
- Notificações, push, Telegram, polling em background. Isso é papel do watcher;
  este servidor só responde quando perguntado.
- Presença/frequência: os plugins `attendance` e `scheduler` da UFSC não expõem
  web service (verificado). Fora de alcance sem scraping.
- OCR de PDF digitalizado. Slides que são imagem pura ficam de fora da v1.

---

## 3. Fatos confirmados (sondagem em 15/09/2026)

Tudo abaixo foi verificado contra o Moodle real, não contra documentação.

| Fato | Detalhe |
|---|---|
| Moodle | 4.1.5+ (Build 20230920), `presencial.moodle.ufsc.br` |
| Token | **397 funções** liberadas — inclusive escrita, daí a allowlist |
| Download de arquivo | `fileurl` + `&token=<T>` → HTTP 200, PDF íntegro (testado com 1,7 MB) |
| Extração de texto | `pdftotext -layout` (poppler 26.01 já instalado) → 18.300 chars de um plano em PDF, com tabela de datas preservada |
| Notas | `gradereport_user_get_grade_items` → 13 itens com `gradeformatted`, `grademax`, feedback |
| Submissões | `mod_assign_get_submission_status` → `"submitted"` / pendente, por assign |
| Metadados do curso | `idnumber` = `turma\|CAGR\|GR\|238\|20262\|INE5617\|07238` → código e turma estruturados, sem regex no nome |
| Início do semestre | `startdate` por disciplina (03/08 a 10/08/2026) → permite converter "Semana 12" em data |
| Catálogo de planos | `programas-planos.inf.ufsc.br` é **público**, sem login, HTML limpo de 6–12 mil chars |
| Cobertura do catálogo | Só INE. `CAD5103` e `PSI7002` retornam página-stub de 2.028 bytes |
| Cache HTTP do catálogo | **Sem `ETag`, sem `Last-Modified`, `Cache-Control: no-store`** → GET condicional impossível; detectar mudança exige baixar os ~20 KB |
| Estabilidade do hash | Duas buscas seguidas do mesmo plano → HTML bruto **e** texto extraído com sha256 idêntico. Hash é seguro para detectar mudança (sem o falso-positivo tipo `course.progress`) |
| Sem WS | `attendance`, `scheduler` (plugins de terceiros) |

**Formato do plano de ensino do INE** (seções numeradas, estáveis):
`1. Identificação · 2. Ementa · 3. Objetivos · 4. Conteúdo Programático ·
5. Metodologia · 6. Avaliação de Aprendizagem · 7. Avaliação de Recuperação ·
8. Cronograma · 9–10. Bibliografia`

Exemplo real do que a §6 entrega (INE5617):
`MF = (Tr * 0,60) + (P * 0,30) + (Ex * 0,10)` — é exatamente o "o que vale nota"
que eu quero, e sai em uma linha.

**Onde mora o documento-mestre de cada disciplina** (§8):

| Disciplina | Forma | Fonte |
|---|---|---|
| INE5633 | módulo `url` → catálogo | `programas-planos/planos/5268` |
| INE5617 | módulo `url` → catálogo | `programas-planos/disciplinas/INE5617/turmas/07238/plano/20262` |
| PSI7002 | módulo `resource` → **PDF no Moodle** | `pluginfile.php/...pdf` (183 KB, cronograma datado: `#18 07.12 Nova avaliação`) |
| INE5680 | sem link no Moodle | catálogo responde pela URL derivada (22 KB) |
| INE5638 | sem link no Moodle | idem (18 KB) |
| CAD5103 | **cronograma em PDF**, não plano | `Cronograma semestre 26.1` (408 KB, `timemodified` 27/08) |

**CAD5103 é o caso que quebra a premissa de "plano de ensino".** Não tem plano —
tem um *cronograma de aulas* que cumpre o mesmo papel: identificação (professora
Monica Scoz Mendes, 4ªs 18:30–22:00), tabela de 21 datas reais (12/08, 26/08,
02/09, …, prova, `09/12 ENTREGA DAS NOTAS E NOTAS FINAIS`) e o sistema de
avaliação. Duas ressalvas achadas no documento real:

- **Sem pesos.** Diz só "Sistema de avaliação (prova e trabalho)", sem fórmula.
  A ficha precisa aceitar `peso: null` (§7).
- **Nome e cabeçalho mentem.** O arquivo se chama `Cronograma semestre 26.1` e o
  título interno diz `2026/1`, mas o corpo diz `Ano: 2026.2` e as datas são do
  semestre corrente. Erro de digitação do professor — motivo pelo qual a ficha
  sempre registra `fonte`, para eu poder conferir.

As seções do CAD5103 também carregam data no nome (`AULAS 1 e 2 - 12/08/2026`):
fonte de datas de graça, sem abrir PDF (fonte 6 da §9).

---

## 4. Arquitetura

```
moodle-mcp/
  src/
    index.ts            entry point (stdio)
    server.ts           registro das tools
    moodle/
      client.ts         POST /webservice/rest/server.php + allowlist + retry
      files.ts          download via fileurl+token, cache por sha256
    planos/
      resolver.ts       3 vias de resolução (§8)
      catalogo.ts       fetch + parse do programas-planos (HTML → seções)
    extract/
      pdf.ts            pdftotext -layout, paginado
      html.ts           HTML → texto limpo
    store/
      db.ts             SQLite próprio (cache + fichas)
      cache.ts          TTL, invalidação, --refresh
    agenda/
      unify.ts          fusão das 5 fontes de data (§9)
      semanas.ts        "Semana 12" + startdate → intervalo de datas
    render/
      text.ts           formatação compacta (§5.2)
    tools/              uma por arquivo, 9 arquivos
  cache/
    files/              PDFs baixados
    text/               texto extraído
  dados.db              SQLite (cache + fichas)
  .env
```

**Fluxo de uma pergunta típica** ("o que tenho essa semana?"):

```
agenda(dias=7)
  → cache hit em cursos/contents/assigns (TTL vivo)
  → lê fichas salvas (pesos das avaliações)
  → unifica 5 fontes de data, deduplica
  → devolve ~200 tokens de texto
```

Zero chamada HTTP no caso comum. A rede só é tocada quando o TTL expira.

---

## 5. Economia de tokens — as sete regras

### 5.1 Poucas tools, descrição de uma linha

9 tools. Descrição em uma frase, sem exemplos embutidos, sem repetir o que o nome
já diz. Parâmetros com default sensato para que o modelo não precise pensar neles.

- Alvo: **≤ 700 tokens** para o bloco inteiro de definições.
- Regra: uma tool nova só entra se substituir duas chamadas frequentes.

### 5.2 Saída em texto compacto, não JSON

Padrão `formato="texto"`. `formato="json"` existe para quando eu pedir dados
estruturados explicitamente.

```
AGENDA 15/09–29/09

INE5617 Gerencia de Projetos
  ! 09/10 Entrega 2 - Plano de Projeto Completo  assign  PENDENTE  60% (Tr)
    30/10 Prova  30% (P)

INE5633 Sistemas Inteligentes
  ! 23/09 Anotacoes Aula 11  assign  PENDENTE  sem nota
```

O mesmo conteúdo em JSON custa ~2,5× por causa de chaves repetidas e aspas.
Sem emoji: cada um custa 1–3 tokens e não carrega informação que `!` não carregue.

### 5.3 Identificadores curtos

O handle da disciplina é o código (`INE5617`), não o `courseid` 49814. Itens são
`INE5617/7` — código + índice sequencial estável dentro da disciplina, resolvido
localmente para `cmid`. Um ID numérico do Moodle aparece 0 vezes na saída normal.

### 5.4 Divulgação progressiva

Nenhuma tool devolve o nível seguinte de detalhe por conta própria:

```
agenda           → só datas e status
disciplinas(cod) → estrutura + ficha, sem conteúdo
materiais(cod)   → nomes, tipos, tamanhos, sem texto
ler(id)          → texto, e só do que foi pedido, paginado
```

### 5.5 Truncamento explícito e barato

Toda lista tem `limite` com default baixo e marca o corte: `… +12 itens (use
limite=30)`. O modelo sabe que há mais e sabe como pedir, sem eu pagar por isso
antes.

### 5.6 Nada de HTML, nada de campo morto

`intro`, `summary`, `description` do Moodle vêm em HTML. São limpos no servidor.
Campos que o modelo nunca usa (`modicon`, `onclick`, `customdata`, `contextid`,
`uservisible`, `sortorder`) não atravessam a fronteira da tool.

### 5.7 Orçamento por tool

Alvos de projeto. Um retorno que estoure o alvo de forma recorrente é bug.

| Tool | Alvo |
|---|---|
| `agenda` (14 dias) | 150–300 |
| `disciplinas` (lista) | ~120 |
| `disciplinas("INE5617")` | ~250 |
| `plano(secao="avaliacao")` | ~400 |
| `plano()` inteiro | 3.000–4.000 |
| `materiais` | ~200 |
| `avisos` | ~300 |
| `notas` | ~150 |
| `buscar` | ~200 |
| `ler` (slide de 30 pág.) | 5.000–15.000 — **sob demanda explícita** |

---

## 6. As nove tools

Nomes em português: o domínio inteiro é PT-BR (disciplina, prazo, aviso, nota) e
isso evita que o modelo traduza ida e volta. Decisão reversível.

---

### `agenda`

> O que vem pela frente: prazos, provas, entregas e pendências.

| Param | Tipo | Default |
|---|---|---|
| `dias` | int | 14 |
| `disciplina` | string? | todas |
| `incluir_entregues` | bool | false |

Fonte: unificação da §9. Ordena por data. Marca `!` o que está pendente e o que
vence em ≤ 3 dias. Anota o peso quando a ficha da disciplina já existe.

---

### `disciplinas`

> Lista as disciplinas do semestre; com `codigo`, detalha uma.

| Param | Tipo | Default |
|---|---|---|
| `codigo` | string? | lista todas |

Sem `codigo` — uma linha por disciplina: código, nome, professor, horário, e se a
ficha já foi extraída.

```
INE5617  Gerencia de Projetos     Jean Carlo Rossa Hauck   3a 20:20, 6a 18:30  ficha:ok
INE5633  Sistemas Inteligentes    Nathalia da Cruz Alves   3a 18:30, 5a 20:20  ficha:ok
CAD5103  Administracao I          -                        -                   ficha:-
```

Com `codigo` — a ficha (fórmula, avaliações, pesos, o que não vale nota), os
próximos prazos, os últimos avisos e os nomes das seções. Sem listar materiais.

---

### `plano`

> Documento-mestre da disciplina (plano de ensino ou cronograma), inteiro ou por seção.

| Param | Tipo | Default |
|---|---|---|
| `codigo` | string | obrigatório |
| `secao` | enum? | inteiro |

`secao` ∈ `identificacao · ementa · objetivos · conteudo · metodologia ·
avaliacao · recuperacao · cronograma · bibliografia · **mudancas**`

Resolve a origem sozinho (§8) e normaliza: HTML do catálogo, PDF de plano e PDF
de cronograma saem no mesmo formato de seções. Quando o documento não tem seção
reconhecível, `secao` avisa que não conseguiu seccionar em vez de devolver o
documento inteiro por engano.

**Sempre revalida** antes de responder (§8.4) — é a tool onde a frescura importa
mais e o custo é zero token.

**`secao="avaliacao"` é o caminho quente**: ~400 tokens em vez de ~3.500.

**`secao="mudancas"`** devolve o diff por seção desde a última ficha salva. É o
que eu leio quando a agenda avisa que o plano mudou: ~100 tokens em vez de reler
o documento.

---

### `salvar_ficha`

> Grava a ficha destilada da disciplina (avaliações, pesos, datas, regras).

| Param | Tipo |
|---|---|
| `codigo` | string |
| `ficha` | objeto (§7) |

É como o trabalho caro vira dado barato: o agente lê o plano uma vez, destila, e
grava. A partir daí `agenda` e `disciplinas` respondem com peso e contexto sem
reler nada. Também alimenta a agenda com datas que só existem no plano (§9).

---

### `materiais`

> Lista os materiais de uma disciplina, sem o conteúdo.

| Param | Tipo | Default |
|---|---|---|
| `codigo` | string | obrigatório |
| `tipo` | enum? | todos (`pdf`, `link`, `pagina`, `pasta`, `tarefa`, `quiz`) |
| `secao` | string? | todas |
| `limite` | int | 30 |

```
INE5633 materiais (20)
  /3   Aula 1 - Introducao                     pdf   1.7MB  12/08  [texto ok]
  /5   Aula 2 - Busca Cega                     pdf   504KB  19/08  [texto ok]
  /8   Documentario The Thinking Game          link          20/08
  … +12 itens (use limite=40)
```

`[texto ok]` = já extraído em cache; ler custa zero rede.

---

### `ler`

> Lê um material: PDF vira texto, link externo vira texto, paginado.

| Param | Tipo | Default |
|---|---|---|
| `id` | string | ex.: `INE5633/3` |
| `de` | int? | 1 |
| `ate` | int? | `de`+9 |

Nunca devolve o documento inteiro sem que as páginas sejam pedidas. O cabeçalho
informa o total (`pág. 1–10 de 34`) para o agente decidir se continua. PDF sem
camada de texto retorna erro explícito, não lixo.

---

### `avisos`

> Avisos dos professores e novidades nos fóruns.

| Param | Tipo | Default |
|---|---|---|
| `dias` | int | 14 |
| `disciplina` | string? | todas |
| `limite` | int | 15 |

Corpo limpo de HTML, truncado em ~300 chars com `…`. `ler_aviso` não existe como
tool separada: o corpo inteiro sai com `limite=1`.

---

### `notas`

> Notas lançadas, o que ainda não tem nota e a média parcial.

| Param | Tipo | Default |
|---|---|---|
| `disciplina` | string? | todas |

Cruza `gradereport_user_get_grade_items` com a ficha: quando a fórmula é conhecida,
calcula o parcial e diz quanto falta.

```
INE5617  Tr 8.5/10 (60%)   P -/10 (30%)   Ex -/10 (10%)   parcial 5.1, falta P e Ex
```

---

### `buscar`

> Busca full-text no material já baixado.

| Param | Tipo | Default |
|---|---|---|
| `termo` | string | obrigatório |
| `disciplina` | string? | todas |
| `limite` | int | 8 |

SQLite FTS5 sobre o texto extraído. Devolve arquivo, página e trecho de ~120
chars. É o que evita `ler` um PDF inteiro para achar uma definição.

---

## 7. A ficha da disciplina

O artefato central. Um plano de ensino de 12 mil caracteres vira ~200 tokens que
respondem "o que vale nota" pelo resto do semestre.

```json
{
  "codigo": "INE5617",
  "professor": "Jean Carlo Rossa Hauck",
  "horario": "3a 20:20 CTC210, 6a 18:30 CTC210",
  "formula": "MF = Tr*0,60 + P*0,30 + Ex*0,10",
  "pesos_conhecidos": true,
  "avaliacoes": [
    { "sigla": "Tr", "nome": "Plano de Projeto + Relatorio", "peso": 0.60,
      "composicao": "0,7 escrito + 0,3 apresentacao", "data": null, "grupo": true },
    { "sigla": "P",  "nome": "Prova", "peso": 0.30, "data": "2026-10-30" },
    { "sigla": "Ex", "nome": "Exercicios", "peso": 0.10 }
  ],
  "nao_vale_nota": ["Anotacoes de aula (Cornell)"],
  "recuperacao": { "regra": "MF >= 3,0 e < 6,0", "data": null },
  "frequencia": "75%, registrada no Moodle",
  "cronograma": { "tipo": "semanas", "marcos": [
    { "semana": 12, "o_que": "Apresentacao 1a parte do Trabalho + PROVA" },
    { "semana": 18, "o_que": "Prova de Recuperacao" }
  ]},
  "fonte": "https://programas-planos.inf.ufsc.br/...",
  "fonte_sha": "2d29a6f4b4af",
  "extraido_em": "2026-09-15"
}
```

`pesos_conhecidos: false` é o caso CAD5103: o cronograma diz "prova e trabalho"
sem fórmula. As avaliações entram com `peso: null`, `notas` não inventa parcial e
a saída diz `pesos nao informados no documento`. Melhor admitir a lacuna do que
chutar 50/50.

`nao_vale_nota` é campo de primeira classe, não observação solta: saber que as
anotações Cornell **não** entram na média muda como eu priorizo a semana.

**Fluxo de destilação** (uma vez por disciplina por semestre):

```
disciplinas()                    → vejo ficha:-
plano("INE5617","avaliacao")     → ~400 tokens
plano("INE5617","cronograma")    → ~150 tokens
salvar_ficha("INE5617", {...})   → grava
```

Custo: ~600 tokens uma vez. Retorno: toda `agenda` e toda `notas` do semestre
sabem o peso de tudo, de graça.

O servidor **não** chama LLM nenhum para destilar — quem destila é o agente com
quem eu já estou conversando. Zero dependência, zero chave de API extra.

**Validação na gravação**: soma dos pesos ≈ 1,0 (tolerância 0,02) **só quando
`pesos_conhecidos`**; datas em ISO e dentro do semestre; siglas únicas. Erro de
validação volta como mensagem, não grava ficha torta.

**Invalidação**: ver §8.4. A ficha guarda o `fonte_sha` do documento de onde
saiu — é a âncora que permite saber, depois, que o documento mudou e o que mudou.

---

## 8. Resolução do documento-mestre

Não é "plano de ensino": é **o documento em que o professor escreveu as regras e
as datas da disciplina**. Três disciplinas usam plano do catálogo INE, uma usa
plano em PDF, uma usa cronograma em PDF. Tratar os três como a mesma coisa é o
que faz a §7 funcionar para todas.

Três vias, em ordem:

**Via 1 — módulo no Moodle.** Procura módulo cujo nome case com
`/plano de ensino|programa da disciplina|ementa|cronograma|calend[áa]rio da disciplina|syllabus/i`.
Havendo mais de um, a precedência é `plano de ensino > programa > ementa >
cronograma`.
- `modname=url` → segue o `externalurl`. Se for `programas-planos.inf.ufsc.br`,
  cai no parser do catálogo.
- `modname=resource` + `mimetype=application/pdf` → baixa com token, `pdftotext`.

**Via 2 — URL derivada do catálogo.** Sem módulo no Moodle, monta a URL a partir
do `idnumber` (`turma|CAGR|GR|238|20262|INE5617|07238`):

```
https://programas-planos.inf.ufsc.br/disciplinas/{CODIGO}/turmas/{TURMA}/plano/{SEMESTRE}
```

Resolve INE5680 e INE5638, que não têm link no Moodle. **Detectar o stub**: o
catálogo responde HTTP 200 mesmo para disciplina que não é do INE, com ~2 KB.
Regra: menos de 4 KB de HTML ou ausência do bloco "1. Identificação" = não existe.

**Via 3 — ausente.** Responde `documento-mestre nao encontrado para XXX (sem
plano/cronograma no Moodle e fora do catalogo do INE)`. Uma linha, sem fallback
criativo, sem inventar. Nesse caso a ficha pode ser ditada por mim e gravada
direto — ela não precisa vir de documento.

### 8.1 Três formatos de seção

| Formato | Onde | Corte |
|---|---|---|
| Arábico numerado | catálogo INE | `^\d+\.\s+Título$` — estável, testado nos 4 planos |
| Romano | PDF PSI7002 (`VII. AVALIAÇÃO`), PDF CAD5103 (`I. IDENTIFICAÇÃO`) | `^[IVX]+\.\s+TÍTULO$` |
| Tabela datada | cronograma CAD5103 | sem seções além da identificação; o corpo é a tabela de aulas |

Quando nenhum corte pega, o documento volta inteiro **com aviso explícito** de
que não foi seccionado. `secao="avaliacao"` num documento não-seccionável avisa
em vez de devolver 5 mil chars sem rótulo.

### 8.2 Extração de datas é trabalho do agente, não do servidor

O servidor entrega texto; quem lê datas sou eu conversando com o agente, na hora
de destilar a ficha. Motivo concreto: no cronograma do CAD5103 o texto contém
`Aulas 13/14`, `Aulas 15/16`, `Aulas 17/18` — que um regex de data lê como
13/14, 15/16 e 17/18. O agente vê o contexto da tabela e não cai nisso; um
`\d{2}/\d{2}` cai sempre.

### 8.3 Cache

30 dias de TTL, **mas com revalidação** (§8.4). O TTL longo é para o texto; a
checagem de mudança é separada e muito mais frequente.

### 8.4 Detecção de mudança — planos mudam no meio do semestre

Professor remarca prova, muda peso, publica cronograma novo. É justamente o que
eu não posso perder, e é o que um cache de 30 dias esconderia.

**Como detectar, por origem:**

| Origem | Sinal | Confiabilidade |
|---|---|---|
| PDF no Moodle | `contents[].timemodified` + `sha256` do arquivo | Alta — pega troca de arquivo com mesmo nome |
| Catálogo INE | `sha256` do **texto normalizado** | Alta — verificado: duas buscas seguidas dão hash idêntico |

O catálogo não manda `ETag` nem `Last-Modified` e ainda responde
`Cache-Control: no-store`, então GET condicional está fora: revalidar é baixar os
~20 KB e comparar hash. **Custo: ~200 ms e zero token**, porque nada disso chega
ao contexto.

**Quando revalidar:**

- `plano` — sempre. É a tool onde frescura importa e o custo é invisível.
- `agenda` e `disciplinas` — se a última checagem tem mais de 12 h; em paralelo,
  sem bloquear a resposta. Falhou a rede? Responde com cache e marca `(sem
  revalidar)`.
- `refresh=true` — força.

**O que acontece quando muda:**

1. Guarda o texto anterior e calcula diff **por seção**.
2. Se a mudança tocar `avaliacao`, `recuperacao` ou `cronograma`, a ficha vai
   para `status=desatualizada` e a agenda abre com uma linha de alerta:

```
! INE5617 documento-mestre mudou em 14/09 — secao Avaliacao
  ficha desatualizada, use plano("INE5617","mudancas")
```

3. Mudança só em `bibliografia`, `ementa` ou `objetivos` atualiza o texto em
   silêncio e registra no histórico. Não vale alarme.
4. **Datas derivadas da ficha antiga entram em quarentena, não são apagadas.**
   Se a prova era 30/10 e o plano novo diz 06/11, eu preciso ver as duas até
   confirmar qual vale:

```
INE5617
    06/11 Prova  30% (P)   plano atualizado 14/09
          era 30/10 na versao anterior — confirmar
```

5. `plano(codigo,"mudancas")` devolve só o diff das seções afetadas (~100
   tokens). Eu leio, corrijo a ficha, `salvar_ficha` de novo, a quarentena
   fecha.

**Histórico**: cada versão do texto fica em `planos_versoes` com sha e data. É o
que permite responder "a prova sempre foi dia 6?" sem depender da minha memória.

---

## 9. Agenda unificada

Seis fontes, nesta precedência:

| # | Fonte | Traz |
|---|---|---|
| 1 | `mod_assign_get_assignments` + `get_submission_status` | prazo **e** se já entreguei |
| 2 | `mod_quiz_get_quizzes_by_courses` | `timeclose` |
| 3 | `core_calendar_get_action_events_by_courses` | eventos do professor |
| 4 | **Ficha do documento-mestre** (§7) | provas que **só existem no PDF/HTML** |
| 5 | Cronograma por semana + `startdate` | "Semana 12: PROVA" → intervalo de datas |
| 6 | Nome da seção do curso | `AULAS 1 e 2 - 12/08/2026` (CAD5103) — data exata, sem abrir PDF |

A fonte 4 é a que fecha o buraco que me faz esquecer coisa: prova anunciada no
documento-mestre e nunca lançada no calendário do Moodle. Em CAD5103, onde o
Moodle tem **zero** assign e zero evento de calendário, as fontes 4 e 6 são as
únicas — sem elas a disciplina aparece vazia na agenda, que é o pior resultado
possível.

**Deduplicação**: chave `(disciplina, data ±1 dia, título normalizado)` com
similaridade por tokens. Moodle sempre vence o documento-mestre — o documento é
intenção, o Moodle é o que está valendo. A exceção é a quarentena de §8.4: data
em disputa aparece duas vezes, de propósito, até eu confirmar.

**Conflito** é informação, não erro:

```
INE5617
    30/10 Prova  30% (P)
          plano de ensino indica semana 12 (~20/10) — Moodle manda
```

**Semana → data**: `startdate + (n-1)*7 dias`, apresentado como intervalo e
sempre marcado `~`. É estimativa e a saída diz isso; feriado e SECCOM deslocam o
calendário real.

**Custo de `submission_status`**: uma chamada por assign (22 hoje). Só é chamado
para assigns com prazo em `[-30d, +60d]`, em paralelo, com TTL de 30 min. Fora
dessa janela, o status vem do cache ou sai como `?`.

---

## 10. Cache e invalidação

SQLite próprio + arquivos em disco. **Nenhuma tool toca a rede se houver cache
vivo.**

| Recurso | TTL | Invalidação |
|---|---|---|
| disciplinas matriculadas | 12 h | `refresh` |
| `core_course_get_contents` | 1 h | `refresh` |
| assigns + quizzes | 1 h | idem |
| submission status | 30 min | após prazo, 6 h |
| notas | 6 h | idem |
| avisos/fóruns | 30 min | idem |
| documento-mestre (texto) | 30 dias | mas **revalidado por hash a cada 12 h** (§8.4) |
| arquivo baixado | permanente | `contents[].timemodified` ou sha256 |
| texto extraído | permanente | vinculado ao sha do arquivo |

Toda tool aceita `refresh=true`. Um `refresh` em `disciplinas` invalida a árvore
inteira daquela disciplina.

O sha256 do arquivo resolve o caso que o watcher não pega: **professor troca o
PDF mantendo o nome**. Muda o sha, o texto é re-extraído.

---

## 11. Modelo de dados local (`dados.db`)

```sql
cursos(codigo PK, courseid, turma, nome, professor, horario,
       startdate, semestre, atualizado_em)

itens(id PK,            -- "INE5633/3"
      codigo, cmid, idx, nome, tipo, secao,
      fileurl, filename, mimetype, filesize, timemodified,
      sha256, path_arquivo, path_texto, paginas, atualizado_em)

fichas(codigo PK, semestre, json, fonte, fonte_sha,
       extraido_em, status)      -- ok | desatualizada

prazos(id PK, codigo, titulo, tipo, data, fonte, peso,
       status, confianca,        -- exata | estimada
       quarentena, data_anterior) -- §8.4: data em disputa

planos_cache(codigo PK, semestre, origem, url, texto, secoes_json,
             sha, buscado_em, revalidado_em)

planos_versoes(codigo, sha, texto, secoes_json, visto_em)  -- histórico (§8.4)

http_cache(chave PK, payload, expira_em)

textos_fts                       -- FTS5: (item_id, pagina, texto)
```

`itens.idx` é sequencial por disciplina e **estável**: uma vez atribuído, não muda
se o professor reordenar a página. É o que sustenta a §5.3.

---

## 12. Segurança

- **Allowlist de funções WS.** O token tem 397 funções, incluindo
  `mod_assign_save_submission`, `mod_forum_add_discussion` e
  `mod_quiz_process_attempt`. O cliente carrega uma lista fixa de ~15 funções de
  leitura e recusa qualquer outra **antes** de montar a requisição. Um agente
  conversacional com acesso a "entregar trabalho" é risco real.
- **Token nunca sai numa resposta de tool.** O download acontece dentro do
  servidor; o que volta é caminho local ou texto. `fileurl` devolvido em
  `materiais` vai sem query string.
- **Token nunca em log.** Redigido no cliente, como o watcher já faz.
- `.env` e `cache/` no `.gitignore` desde o primeiro commit — material de
  disciplina e nomes de colegas em fórum não vão para repositório.
- Servidor **stdio local**. Sem porta aberta, sem SSE, sem exposição de rede.

---

## 13. Stack

| Item | Escolha | Por quê |
|---|---|---|
| Runtime | Node 20 (v20.19.4 instalado) | mesmo ambiente que já uso |
| SDK | `@modelcontextprotocol/sdk@1.30.0` | versão atual verificada em 15/09/2026 |
| Schemas | `zod` | exigido pelo SDK |
| Banco | `better-sqlite3@13` | síncrono, sem pool, FTS5 nativo |
| PDF | `pdftotext -layout` (poppler 26.01) | já instalado, preserva tabelas de cronograma |
| HTTP | `fetch` nativo | zero dependência |
| Transporte | stdio | local, sem porta |

Sem `dotenv`: o `.env` é lido e parseado em ~10 linhas.

**Fallback de PDF**: se `pdftotext` sumir do sistema, erro claro na inicialização,
com a instrução (`apt install poppler-utils`). Não silencia.

---

## 14. Configuração e registro

`.env` **próprio** (copiar o token do `.env` atual do watcher ou gerar outro em
Moodle → Preferências → Chaves de segurança):

```env
MOODLE_URL=https://presencial.moodle.ufsc.br
MOODLE_TOKEN=...
SEMESTRE=auto          # auto = deduz da data; ou 20262
CACHE_DIR=./cache
DB_PATH=./dados.db
CATALOGO_URL=https://programas-planos.inf.ufsc.br
```

`SEMESTRE=auto`: deduz de mês/ano (jan–jul → `N1`, ago–dez → `N2`) e confere
contra os `startdate` das disciplinas. Semestre fixo em `.env` é exatamente o tipo
de coisa que quebra em silêncio em março.

Registro no Claude Code (`.mcp.json` na raiz do projeto ou global):

```json
{
  "mcpServers": {
    "moodle": {
      "command": "node",
      "args": ["/home/lucas/Documentos/desenvolvimento/ufsc/moodle-mcp/dist/index.js"]
    }
  }
}
```

---

## 15. Fases

**Fase 1 — o esqueleto que já serve** (~4 h)
`client` com allowlist · `store` + TTL · `disciplinas` · `agenda` (fontes 1–3) ·
`avisos`.
Entregue isto, já respondo "o que tenho essa semana" sem abrir o navegador.

**Fase 2 — documento-mestre e a ficha** (~6 h)
`resolver` das 3 vias · parsers dos 3 formatos de seção · `plano` ·
`salvar_ficha` · revalidação por hash + diff por seção + quarentena (§8.4) ·
fontes 4–6 da agenda · semana→data.
É aqui que entra "o que vale nota" — e a garantia de que ele não envelhece calado.

**Fase 3 — material sob demanda** (~4 h)
`materiais` · `ler` paginado · cache por sha · FTS5 · `buscar`.

**Fase 4 — desempenho** (~2 h)
`notas` com parcial calculado · `submission_status` na agenda ·
`incluir_entregues`.

**Fase 5 — polimento** (~3 h)
Medir o custo real de cada tool contra os alvos da §5.7, apertar formato, revisar
descrições das tools.

Total ~18 h. Fases 1 e 2 já entregam o valor principal.

---

## 16. Riscos e decisões em aberto

| Risco | Mitigação |
|---|---|
| **Documento-mestre muda no meio do semestre** | Revalidação por hash a cada 12 h, diff por seção, ficha marcada desatualizada, data antiga em quarentena (§8.4) |
| Revalidação cara demais | 20 KB e ~200 ms, fora do contexto; em paralelo, nunca bloqueando a resposta |
| HTML do catálogo muda de estrutura | Parser tolerante (corta por `^\d+\.`), teste com os 4 planos reais, erro explícito em vez de texto errado |
| Documento sem seção reconhecível | Aviso honesto de que não seccionou; 3 formatos suportados (árabe, romano, tabela) |
| Documento sem pesos (CAD5103) | `pesos_conhecidos: false`; `notas` não calcula parcial falso |
| `ler` estourando contexto | Paginação obrigatória com default de 10 páginas; `buscar` como caminho preferencial |
| Ficha destilada com erro do modelo | Validação de soma de pesos na gravação; `fonte` sempre citada para eu conferir |
| 22 chamadas de `submission_status` | Janela de tempo + paralelismo + TTL (§9) |
| Semana→data errada por feriado | Sempre marcado `~` e sempre perde para o Moodle |
| Rate limit do Moodle | `Retry-After` respeitado; cache é a defesa principal |

**Em aberto:**

1. **CAD5103 tem cronograma, mas sem pesos.** O documento dá as datas e diz
   "prova e trabalho", sem fórmula. A ficha entra com `pesos_conhecidos: false`
   e eu completo os pesos ditando ao agente quando a professora informar — a
   ficha aceita gravação manual, não precisa vir de documento.
2. **Nomes de tool em português.** Decidido assim; trocar depois é renomear
   arquivo e string.
3. **`buscar` sobre PDFs não lidos.** Hoje busca só no que já foi extraído. Fazer
   pré-extração de tudo no primeiro uso da disciplina custa tempo, não tokens —
   pode valer a pena na Fase 3.
4. **Histórico de mudanças** ("o que apareceu de novo desde ontem") não está no
   escopo: exige estado longitudinal, que é o que o watcher faz. Se eu quiser
   isso aqui, é decisão consciente de duplicar, não acidente.
