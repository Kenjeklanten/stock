import { HttpError } from '../../_lib/http.js';

/** Beheerschermen zijn enkel voor de adressen in ADMIN_EMAILS (leeg = iedereen met Access). */
export function requireAdmin(data) {
  if (data && data.user && data.user.admin === false) {
    throw new HttpError('Je hebt geen beheerrechten voor deze tool.', 403);
  }
}
