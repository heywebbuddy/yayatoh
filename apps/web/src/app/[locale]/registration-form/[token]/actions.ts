'use server';

import {
  publicCompanySuggestions,
  publicRespondent,
  respondentEventId,
  respondentRef,
  saveRegistrationPageCommand,
} from '@yayatoh/forms';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { publicProgram } from '@yayatoh/program';
import { refresh } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { eventNameOf, submitRegistrationForm } from '@/server/registration-forms.ts';

export interface RespondState {
  readonly code: string | null;
  readonly reason?: string;
  readonly field?: string;
  readonly retryMinutes?: number;
  /** The resume link was emailed. */
  readonly emailed?: boolean;
  /** Changes on every result so the form can announce and move focus. */
  readonly stamp?: number;
}

const INTENTS = ['next', 'back', 'email'] as const;

/**
 * One page of a registration form (public, by the person's own link): read the questions that
 * were on screen, save them and move (`next` submits on the last page), go `back`, or save and
 * `email` the resume link. The server recomputes the path and refuses anything off it.
 */
export async function respondAction(
  token: string,
  pageKey: string,
  _prev: RespondState,
  form: FormData,
): Promise<RespondState> {
  const locale = await getLocale();
  const stamp = Date.now();
  const intent = INTENTS.find((i) => i === form.get('intent')) ?? 'next';
  const ref = await respondentRef(token);
  if (!ref) return { code: 'not_found', stamp };
  const view = await publicRespondent(token, { eventName: eventNameOf });
  if (!view || view.state !== 'open' || view.page?.key !== pageKey) {
    // Another tab moved on or submitted: show the current state.
    refresh();
    return {
      code: 'invalid_state',
      reason: view?.state === 'open' ? 'stale' : (view?.state ?? 'expired'),
      stamp,
    };
  }
  const shown = new Set(form.getAll('__shown').map(String));
  const answers: Record<string, unknown> = {};
  for (const f of view.page.fields) {
    if (!shown.has(f.key)) continue;
    if (f.type === 'checkbox' || f.type === 'consent') answers[f.key] = form.get(f.key) === 'on';
    else if (f.type === 'multi_select') answers[f.key] = form.getAll(f.key).map(String);
    else answers[f.key] = String(form.get(f.key) ?? '');
  }
  if (intent === 'email') {
    const limit = await limitAction('registrationForm', { identity: ref.respondentId, scope: 'resume' });
    if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit), stamp };
  }
  const ctx = createCtx({ orgId: ref.orgId, locale });
  try {
    const r = await executeCommand(
      saveRegistrationPageCommand,
      { token, pageKey, answers, intent },
      ctx,
      ports,
    );
    if (intent === 'next' && r.pageKey === pageKey)
      await executeCommand(submitRegistrationForm, { token, pageKey, answers: {} }, ctx, ports);
    refresh();
    return { code: null, emailed: r.emailed, stamp };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return {
      code: err.code,
      reason: String(err.details?.reason ?? ''),
      ...(typeof err.details?.field === 'string' ? { field: err.details.field } : {}),
      stamp,
    };
  }
}

/**
 * Company suggestions for a company question: the org's exhibitors and sponsors at this event
 * (public already) and companies at least two registrants named. Two letters minimum.
 */
export async function suggestCompaniesAction(token: string, prefix: string): Promise<string[]> {
  const p = prefix.trim().toLowerCase();
  if (p.length < 2 || p.length > 100) return [];
  const ref = await respondentRef(token);
  if (!ref) return [];
  const eventId = await respondentEventId(ref);
  const [named, program] = await Promise.all([
    publicCompanySuggestions(ref.orgId, p),
    eventId ? publicProgram({ orgId: ref.orgId, eventId }) : null,
  ]);
  const listed = [
    ...(program?.exhibitors.map((x) => x.name) ?? []),
    ...(program?.sponsorTiers.flatMap((tier) => tier.sponsors.map((s) => s.name)) ?? []),
  ].filter((n) => n.toLowerCase().startsWith(p));
  const seen = new Set<string>();
  return [...listed, ...named]
    .filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .slice(0, 8);
}
