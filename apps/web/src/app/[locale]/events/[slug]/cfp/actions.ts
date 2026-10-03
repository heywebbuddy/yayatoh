'use server';

import { pageTarget } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { publicCfp, submitCfpCommand } from '@yayatoh/program';
import { getLocale } from 'next-intl/server';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

export interface CfpFormState {
  readonly ok: boolean;
  readonly code: string | null;
  /** The input to mark: a fixed field name, `co{n}Name` / `co{n}Email`, or `q:{key}`. */
  readonly field?: string;
  readonly reason?: string;
  readonly retryMinutes?: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/** A command's validation path (`coSpeakers.0.email`, `speakerEmail`) as the form's input name. */
function fieldOf(path: string): string {
  const co = /^coSpeakers\.(\d+)(?:\.(name|email))?$/.exec(path);
  if (co) return `co${co[1]}${co[2] === 'name' ? 'Name' : 'Email'}`;
  return path.split('.')[0] ?? path;
}

/**
 * Send a proposal to an event's call for papers (public, M5.3b). The org and event come from the
 * slug (server-side, the event's public page), never from a header; rate-limited per device, IP
 * and submitter address. The command checks the call is open and validates everything again.
 */
export async function submitCfpAction(
  slug: string,
  _prev: CfpFormState,
  form: FormData,
): Promise<CfpFormState> {
  const locale = await getLocale();
  const target = await pageTarget(slug);
  const call = target ? await publicCfp(target) : null;
  if (!target || !call) return { ok: false, code: 'not_found' };
  if (call.state !== 'open') return { ok: false, code: 'invalid_state', reason: call.state };
  const required: [string, string][] = [
    ['title', text(form, 'title')],
    ['abstract', text(form, 'abstract')],
    ['speakerName', text(form, 'speakerName')],
  ];
  for (const [field, v] of required) if (!v) return { ok: false, code: 'validation_failed', field };
  const speakerEmail = text(form, 'speakerEmail');
  if (!EMAIL.test(speakerEmail)) return { ok: false, code: 'validation_failed', field: 'speakerEmail' };
  const coSpeakers: { name: string; email: string }[] = [];
  for (let i = 0; i < call.maxCoSpeakers; i++) {
    const name = text(form, `co${i}Name`);
    const email = text(form, `co${i}Email`);
    if (!name && !email) continue;
    if (!name) return { ok: false, code: 'validation_failed', field: `co${i}Name` };
    if (!EMAIL.test(email)) return { ok: false, code: 'validation_failed', field: `co${i}Email` };
    coSpeakers.push({ name, email });
  }
  const answers: Record<string, unknown> = {};
  for (const q of call.form?.fields ?? []) {
    const name = `q:${q.key}`;
    if (q.type === 'multi_select') {
      const all = form.getAll(name).map(String);
      if (all.length) answers[q.key] = all;
    } else {
      const v = text(form, name);
      if (v) answers[q.key] = q.type === 'checkbox' ? true : q.type === 'number' ? Number(v) : v;
    }
  }
  const limit = await limitAction('cfpSubmit', { identity: speakerEmail.toLowerCase(), scope: 'submit' });
  if (!limit.allowed) return { ok: false, code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  try {
    await executeCommand(
      submitCfpCommand,
      {
        eventId: target.eventId,
        title: text(form, 'title'),
        abstract: text(form, 'abstract'),
        durationMinutes: Number(form.get('durationMinutes') ?? 0),
        trackId: text(form, 'trackId') || null,
        speakerName: text(form, 'speakerName'),
        speakerEmail,
        speakerTitle: text(form, 'speakerTitle') || null,
        speakerCompany: text(form, 'speakerCompany') || null,
        speakerBio: text(form, 'speakerBio'),
        coSpeakers,
        answers,
      },
      createCtx({ orgId: target.orgId, locale }),
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = (err.details ?? {}) as { issues?: { path: string }[]; field?: unknown; reason?: unknown };
    const reason = typeof d.reason === 'string' ? d.reason : undefined;
    const path = typeof d.field === 'string' ? d.field : d.issues?.[0]?.path;
    const field = path ? (reason === 'form_invalid' ? `q:${path}` : fieldOf(path)) : undefined;
    return { ok: false, code: err.code, ...(field ? { field } : {}), ...(reason ? { reason } : {}) };
  }
  return { ok: true, code: null };
}
