import 'server-only';
import { getUserTheme, SESSION_COOKIE_BASENAME } from '@yayatoh/auth';
import { DEFAULT_THEME, isThemeChoice, THEME_COOKIE, type ThemeChoice } from '@yayatoh/ui/tokens';
import { cookies } from 'next/headers';
import { getSession } from './session.ts';

/**
 * The colour theme for this response (ADR 0022), read on the server so the first paint is right:
 * the browser's own choice (cookie) wins; without one, a signed-in person's saved choice follows
 * them to a new browser; otherwise light. "System" is resolved by CSS (prefers-color-scheme).
 */
export async function currentTheme(): Promise<ThemeChoice> {
  const jar = await cookies();
  const chosen = jar.get(THEME_COOKIE)?.value;
  if (isThemeChoice(chosen)) return chosen;
  if (!jar.getAll().some((c) => c.name.includes(SESSION_COOKIE_BASENAME))) return DEFAULT_THEME;
  const session = await getSession().catch(() => null);
  if (!session || session.impersonation) return DEFAULT_THEME;
  return (await getUserTheme(session.userId).catch(() => null)) ?? DEFAULT_THEME;
}
