'use server';

import { guestSiteTarget, SITE_PASSWORD_MAX, unlockGuestSiteQuery } from '@yayatoh/guests';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getHumanCheck, passedHumanCheck } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { rememberSiteAccess } from './access.ts';

export type UnlockError = 'empty' | 'wrong' | 'challengeFailed' | 'rateLimited' | 'closed';

export interface UnlockState {
  readonly error?: UnlockError;
  /** Past this device's budget: show the human check and ask again. */
  readonly challenge?: boolean;
  readonly retryMinutes?: number;
  readonly stamp?: number;
}

/**
 * A guest types the website's password (M4.5a). The site comes from its address (server-side
 * lookup, published sites of live orgs only), never from input. Limited per device, address and
 * site (M1.14 `guestSitePassword`); past the device budget each try needs the human check. The
 * right password sets the access cookie and reloads the page; the password is never kept.
 */
export async function unlockSiteAction(
  code: string,
  _prev: UnlockState,
  form: FormData,
): Promise<UnlockState> {
  return unlock(code, form, '');
}

/** M4.5b: the same gate on the gallery and slideshow pages, coming back to that page. */
export async function unlockSiteThenAction(
  code: string,
  then: 'gallery' | 'slideshow',
  _prev: UnlockState,
  form: FormData,
): Promise<UnlockState> {
  return unlock(code, form, then === 'gallery' ? '/gallery' : '/slideshow');
}

async function unlock(
  code: string,
  form: FormData,
  then: '' | '/gallery' | '/slideshow',
): Promise<UnlockState> {
  const stamp = Date.now();
  const password = String(form.get('password') ?? '').slice(0, SITE_PASSWORD_MAX * 4);
  const target = await guestSiteTarget(code);
  if (!target) return { error: 'closed', stamp };
  if (!password.trim()) return { error: 'empty', stamp };
  const limit = await limitAction('guestSitePassword', { identity: code.toUpperCase(), scope: 'site' });
  if (!limit.allowed) {
    const passed = await passedHumanCheck(form);
    if (passed === false) return { challenge: true, error: 'challengeFailed', stamp };
    if (passed !== true)
      return getHumanCheck()
        ? { challenge: true, stamp }
        : { error: 'rateLimited', retryMinutes: retryAfterMinutes(limit), stamp };
  }
  const locale = await getLocale();
  let access: string | null;
  try {
    ({ access } = await executeQuery(
      unlockGuestSiteQuery,
      { eventId: target.eventId, password },
      createCtx({ orgId: target.orgId, locale }),
      ports,
    ));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { error: 'closed', stamp };
  }
  if (!access) return { error: 'wrong', stamp, ...(limit.allowed ? {} : { challenge: true }) };
  await rememberSiteAccess(code, access);
  return redirect({ href: `/w/${code}${then}`, locale });
}
