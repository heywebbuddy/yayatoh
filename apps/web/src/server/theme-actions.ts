'use server';

import { setUserTheme } from '@yayatoh/auth';
import { isThemeChoice, THEME_COOKIE } from '@yayatoh/ui/tokens';
import { cookies } from 'next/headers';
import { requestHost } from './request-origin.ts';
import { ownSession } from './session.ts';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Remember the colour theme (ADR 0022): in a cookie for this browser (read on the server for the
 * next first paint) and, when signed in as yourself, in your profile so it follows you. Staff
 * impersonating someone change only their own browser.
 */
export async function setThemeAction(theme: string): Promise<{ ok: boolean }> {
  if (!isThemeChoice(theme)) return { ok: false };
  (await cookies()).set(THEME_COOKIE, theme, {
    path: '/',
    maxAge: YEAR_SECONDS,
    sameSite: 'lax',
    httpOnly: true,
    secure: (await requestHost()).protocol === 'https:',
  });
  const session = await ownSession().catch(() => null);
  if (session) await setUserTheme(session.userId, theme);
  return { ok: true };
}
