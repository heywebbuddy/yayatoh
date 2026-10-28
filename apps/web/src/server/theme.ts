import 'server-only';
import { getUserTheme, SESSION_COOKIE_BASENAME } from '@yayatoh/auth';
import { DEFAULT_THEME, isThemeChoice, THEME_COOKIE, type ThemeChoice } from '@yayatoh/ui/tokens';
import { cookies, headers } from 'next/headers';
import { showcaseSurfaceFor } from '@/lib/showcase-routes.ts';
import { getSession } from './session.ts';

/**
 * The colour theme for this response (ADR 0022), read on the server so the first paint is right:
 * the browser's own choice (cookie) wins; without one, a signed-in person's saved choice follows
 * them to a new browser; otherwise `fallback` (light; the public showcase site follows the system). "System" is resolved by CSS (prefers-color-scheme).
 */
export async function currentTheme(fallback: ThemeChoice = DEFAULT_THEME): Promise<ThemeChoice> {
  const jar = await cookies();
  const chosen = jar.get(THEME_COOKIE)?.value;
  if (isThemeChoice(chosen)) return chosen;
  if (!jar.getAll().some((c) => c.name.includes(SESSION_COOKIE_BASENAME))) return fallback;
  const session = await getSession().catch(() => null);
  if (!session || session.impersonation) return fallback;
  return (await getUserTheme(session.userId).catch(() => null)) ?? fallback;
}

/** The theme of the page being rendered: the public showcase site starts from the system setting. */
export async function pageTheme(): Promise<ThemeChoice> {
  const showcase = showcaseSurfaceFor((await headers()).get('x-yy-path'));
  return currentTheme(showcase ? 'system' : undefined);
}
