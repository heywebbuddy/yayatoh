'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { manageTokenOrg } from '@yayatoh/orders';
import {
  FAVORITE_CHOICES,
  type FavoriteChoice,
  favoriteSessionCommand,
  rotateCalendarFeedCommand,
} from '@yayatoh/registration';
import { revalidatePath } from 'next/cache';
import type { FavoriteActionState, FeedActionState } from '@/components/conference-hub/types.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * The conference hub's actions (M5.10a). The order's manage link is the only credential: the org
 * comes from it (never from the request) and the commands re-check the registrant and session.
 * Rate limited like "My schedule" (M5.2b).
 */
async function guard(token: string) {
  const limit = await limitAction('sessionEnrollment', { identity: `order:${token}` });
  if (!limit.allowed) return { error: 'rate_limited' as const };
  const orgId = await manageTokenOrg(token);
  if (!orgId) return { error: 'not_found' as const };
  return { ctx: createCtx({ orgId }) };
}

/** Star or un-star a session; an overlap comes back as a prompt (keep both / replace). */
export async function favoriteAction(
  token: string,
  registrantId: string,
  sessionId: string,
  _prev: FavoriteActionState,
  form: FormData,
): Promise<FavoriteActionState> {
  const g = await guard(token);
  if ('error' in g) return { ok: false, code: g.error ?? 'internal' };
  const favorite = String(form.get('favorite') ?? '') === 'on';
  const raw = String(form.get('choice') ?? 'refuse');
  const choice = (FAVORITE_CHOICES as readonly string[]).includes(raw) ? (raw as FavoriteChoice) : 'refuse';
  try {
    const r = await executeCommand(
      favoriteSessionCommand,
      { token, registrantId, sessionId, favorite, choice },
      g.ctx,
      ports,
    );
    revalidatePath(`/orders/${token}/hub`);
    return { ok: true, code: null, favorite: r.favorite, removed: r.removed.length, stamp: Date.now() };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = (err.details ?? {}) as {
      reason?: string;
      conflicts?: { title: string; kind: 'enrolled' | 'favorite' }[];
      replace?: boolean;
    };
    return {
      ok: false,
      code: err.code,
      reason: d.reason,
      conflicts: (d.conflicts ?? []).map((c) => ({ title: c.title, kind: c.kind })),
      replace: d.replace === true,
      stamp: Date.now(),
    };
  }
}

/** "Replace the link": every earlier calendar feed link stops working. */
export async function rotateFeedAction(
  token: string,
  registrantId: string,
  _prev: FeedActionState,
  _form: FormData,
): Promise<FeedActionState> {
  const g = await guard(token);
  if ('error' in g) return { ok: false, code: g.error ?? 'internal' };
  try {
    await executeCommand(rotateCalendarFeedCommand, { token, registrantId }, g.ctx, ports);
    revalidatePath(`/orders/${token}/hub`);
    return { ok: true, code: null, stamp: Date.now() };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, code: err.code };
  }
}
