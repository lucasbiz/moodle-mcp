import * as fs from 'fs';
import { carregarConfig, caminhoEnv, inferirSemestre } from '../config';
import { pdftotextDisponivel } from '../extract/pdf';
import { chamar } from '../moodle/client';
import { FUNCOES_PERMITIDAS } from '../moodle/allowlist';
import { db } from '../store/db';
import { listarCursos } from '../moodle/cursos';

function marca(ok: boolean): string {
  return ok ? 'ok  ' : 'FALHA';
}

export async function doctor(): Promise<number> {
  const linhas: string[] = [];
  let problemas = 0;

  const cfg = carregarConfig();
  linhas.push(`raiz        ${cfg.raiz}`);
  linhas.push(`.env        ${caminhoEnv()} ${fs.existsSync(caminhoEnv()) ? '' : '(ausente)'}`);
  linhas.push(`moodle      ${cfg.moodleUrl}`);
  linhas.push(`semestre    ${cfg.semestre}${cfg.semestreAuto ? ` (auto, deduzido de hoje: ${inferirSemestre()})` : ' (fixo)'}`);
  linhas.push(`banco       ${cfg.dbPath}`);
  linhas.push(`cache       ${cfg.cacheDir}`);
  linhas.push('');

  const temToken = cfg.token.length > 0;
  linhas.push(`${marca(temToken)} MOODLE_TOKEN ${temToken ? `presente (${cfg.token.length} chars)` : 'AUSENTE — preencha o .env'}`);
  if (!temToken) problemas++;

  const temPdf = await pdftotextDisponivel();
  linhas.push(`${marca(temPdf)} pdftotext ${temPdf ? 'disponivel' : 'ausente — sudo apt install poppler-utils'}`);
  if (!temPdf) problemas++;

  try {
    db().prepare('SELECT 1').get();
    linhas.push(`${marca(true)} sqlite gravavel`);
  } catch (e) {
    linhas.push(`${marca(false)} sqlite: ${(e as Error).message}`);
    problemas++;
  }

  linhas.push(`${marca(true)} allowlist com ${FUNCOES_PERMITIDAS.size} funcoes de leitura (escrita bloqueada)`);

  if (temToken) {
    try {
      const info = await chamar<{ sitename: string; release: string; functions?: unknown[] }>(
        'core_webservice_get_site_info'
      );
      linhas.push(`${marca(true)} conexao: ${info.sitename} (${info.release}), ${info.functions?.length ?? '?'} funcoes no token`);
      const cursos = await listarCursos(true);
      linhas.push(`${marca(cursos.length > 0)} ${cursos.length} disciplinas: ${cursos.map((c) => c.codigo).join(', ') || '(nenhuma)'}`);
      if (cursos.length === 0) problemas++;
    } catch (e) {
      linhas.push(`${marca(false)} conexao: ${(e as Error).message}`);
      problemas++;
    }
  }

  process.stdout.write(linhas.join('\n') + '\n');
  return problemas;
}
