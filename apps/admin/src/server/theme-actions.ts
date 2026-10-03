'use server';

import { setUserTheme } from '@yayatoh/auth';
import { isThemeChoice, THEME_COOKIE } from '@yayatoh/ui/tokens';
import { cookies, headers } from 'next/headers';
import { currentStaff } from './staff.ts';

/** Remember the colour theme in this browser and in the staff member's profile (ADR 0022). */
export async function setThemeAction(theme: string): Promise<{ ok: boolean }> {
  if (!isThemeChoice(theme)) return { ok: false };
  const proto = (await headers()).get('x-forwarded-proto') ?? 'http';
  (await cookies()).set(THEME_COOKIE, theme, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
    httpOnly: true,
    secure: proto === 'https',
  });
  const staff = await currentStaff().catch(() => null);
  if (staff && staff !== 'signed_out') await setUserTheme(staff.userId, theme);
  return { ok: true };
}
