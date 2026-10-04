/**
 * O token tem ~397 funcoes liberadas, inclusive escrita
 * (mod_assign_save_submission, mod_forum_add_discussion, mod_quiz_process_attempt).
 * Um agente conversacional com acesso a "entregar trabalho" e risco real:
 * o cliente recusa qualquer funcao fora desta lista ANTES de montar a requisicao.
 */
export const FUNCOES_PERMITIDAS: ReadonlySet<string> = new Set([
  'core_webservice_get_site_info',
  'core_enrol_get_users_courses',
  'core_course_get_courses_by_field',
  'core_course_get_contents',
  'core_course_get_course_module',
  'mod_assign_get_assignments',
  'mod_assign_get_submission_status',
  'mod_quiz_get_quizzes_by_courses',
  'mod_quiz_get_user_attempts',
  'mod_quiz_get_user_best_grade',
  'core_calendar_get_action_events_by_courses',
  'mod_forum_get_forums_by_courses',
  'mod_forum_get_forum_discussions',
  'mod_forum_get_discussion_posts',
  'gradereport_user_get_grade_items',
  'mod_resource_get_resources_by_courses',
  'mod_url_get_urls_by_courses',
  'mod_page_get_pages_by_courses',
]);

export function verificarPermitida(funcao: string): void {
  if (!FUNCOES_PERMITIDAS.has(funcao)) {
    throw new Error(
      `funcao "${funcao}" bloqueada pela allowlist (servidor e somente-leitura)`
    );
  }
}
