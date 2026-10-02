import 'server-only';
import { getUserTheme } from '@yayatoh/auth';
import { DEFAULT_THEME, isThemeChoice, THEME_COOKIE, type ThemeChoice } from '@yayatoh/ui/tokens';
import { cookies } from 'next/headers';
import { currentStaff } from './staff.ts';

/** The colour theme (ADR 0022): this browser's choice, else the staff member's saved one, else light. */
export async function currentTheme(): Promise<ThemeChoice> {
  const chosen = (await cookies()).get(THEME_COOKIE)?.value;
  if (isThemeChoice(chosen)) return chosen;
  const staff = await currentStaff().catch(() => null);
  if (!staff || staff === 'signed_out') return DEFAULT_THEME;
  return (await getUserTheme(staff.userId).catch(() => null)) ?? DEFAULT_THEME;
}
