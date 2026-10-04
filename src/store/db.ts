import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { carregarConfig } from '../config';
import { log } from '../logger';

let instancia: Database.Database | null = null;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS cursos (
  codigo        TEXT PRIMARY KEY,
  courseid      INTEGER NOT NULL,
  turma         TEXT,
  nome          TEXT NOT NULL,
  professor     TEXT,
  horario       TEXT,
  startdate     INTEGER,
  semestre      TEXT,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS itens (
  id            TEXT PRIMARY KEY,           -- "INE5633/3"
  codigo        TEXT NOT NULL,
  chave         TEXT NOT NULL,              -- cmid, ou cmid#arquivo (item dentro de pasta)
  cmid          INTEGER,
  idx           INTEGER NOT NULL,
  nome          TEXT NOT NULL,
  tipo          TEXT NOT NULL,              -- pdf | link | pagina | pasta | tarefa | quiz | outro
  secao         TEXT,
  modname       TEXT,
  url           TEXT,                       -- externalurl, para modname=url
  fileurl       TEXT,
  filename      TEXT,
  mimetype      TEXT,
  filesize      INTEGER,
  timemodified  INTEGER,
  sha256        TEXT,
  path_arquivo  TEXT,
  path_texto    TEXT,
  paginas       INTEGER,
  descricao     TEXT,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_itens_codigo ON itens(codigo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_itens_codigo_idx ON itens(codigo, idx);
CREATE UNIQUE INDEX IF NOT EXISTS idx_itens_chave ON itens(codigo, chave);

CREATE TABLE IF NOT EXISTS fichas (
  codigo      TEXT PRIMARY KEY,
  semestre    TEXT NOT NULL,
  json        TEXT NOT NULL,
  fonte       TEXT,
  fonte_sha   TEXT,
  extraido_em TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ok',   -- ok | desatualizada
  textos_sha  TEXT                          -- {itemId: sha8} dos quadros de texto na destilacao
);

CREATE TABLE IF NOT EXISTS prazos (
  id            TEXT PRIMARY KEY,
  codigo        TEXT NOT NULL,
  titulo        TEXT NOT NULL,
  tipo          TEXT NOT NULL,              -- prova | trabalho | entrega | aula | outro
  data          TEXT,                       -- ISO yyyy-mm-dd
  fonte         TEXT NOT NULL,              -- ficha | cronograma | secao
  peso          REAL,
  sigla         TEXT,
  status        TEXT,
  confianca     TEXT NOT NULL DEFAULT 'exata',  -- exata | estimada
  quarentena    INTEGER NOT NULL DEFAULT 0,
  data_anterior TEXT,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prazos_codigo ON prazos(codigo);

CREATE TABLE IF NOT EXISTS planos_cache (
  codigo        TEXT PRIMARY KEY,
  semestre      TEXT,
  origem        TEXT,                        -- catalogo | pdf_moodle | pdf_url
  url           TEXT,
  titulo        TEXT,
  texto         TEXT,
  secoes_json   TEXT,
  sha           TEXT,
  buscado_em    TEXT,
  revalidado_em TEXT
);

CREATE TABLE IF NOT EXISTS planos_versoes (
  codigo      TEXT NOT NULL,
  sha         TEXT NOT NULL,
  texto       TEXT,
  secoes_json TEXT,
  visto_em    TEXT NOT NULL,
  PRIMARY KEY (codigo, sha)
);

CREATE TABLE IF NOT EXISTS http_cache (
  chave     TEXT PRIMARY KEY,
  payload   TEXT NOT NULL,
  expira_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_http_expira ON http_cache(expira_em);

CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS textos_fts USING fts5(
  item_id, codigo, pagina UNINDEXED, texto,
  tokenize = "unicode61 remove_diacritics 2"
);
`;

/** ALTER TABLE idempotente: CREATE TABLE IF NOT EXISTS nao adiciona coluna nova. */
function migrar(d: Database.Database): void {
  const colunas: Array<[string, string, string]> = [
    ['fichas', 'textos_sha', 'TEXT'],
  ];
  for (const [tabela, coluna, tipo] of colunas) {
    const existe = (d.pragma(`table_info(${tabela})`) as Array<{ name: string }>).some(
      (c) => c.name === coluna
    );
    if (!existe) {
      d.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
      log.debug(`migracao: ${tabela}.${coluna} adicionada`);
    }
  }
}

export function db(): Database.Database {
  if (instancia) return instancia;
  const cfg = carregarConfig();
  fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  const d = new Database(cfg.dbPath);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.exec(ESQUEMA);
  migrar(d);
  instancia = d;
  log.debug(`sqlite aberto em ${cfg.dbPath}`);
  return d;
}

export function fecharDb(): void {
  if (instancia) {
    instancia.close();
    instancia = null;
  }
}

export function metaGet(chave: string): string | null {
  const r = db().prepare('SELECT valor FROM meta WHERE chave = ?').get(chave) as
    | { valor: string }
    | undefined;
  return r?.valor ?? null;
}

export function metaSet(chave: string, valor: string): void {
  db()
    .prepare('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, valor);
}

export function agora(): string {
  return new Date().toISOString();
}
