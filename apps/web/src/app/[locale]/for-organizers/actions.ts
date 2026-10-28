'use server';

import { EVENT_TYPES, logApplicantEmail, renderPlainEmail, submitApplication } from '@yayatoh/applications';
import { PLATFORM_SENDER } from '@yayatoh/notifications';
import { getLocale, getTranslations } from 'next-intl/server';
import { ZodError } from 'zod';
import type { FormState } from '@/lib/form-state.ts';
import { success } from '@/server/form.ts';
import { getHumanCheck, passedHumanCheck } from '@/server/human-check.ts';
import { webTransports } from '@/server/mail-transports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

const str = (form: FormData, k: string) => String(form.get(k) ?? '').trim();

/** Where the staff alert goes (the owner's sales/ops inbox). */
const alertAddress = () =>
  process.env.APPLICATIONS_ALERT_EMAIL?.trim() || process.env.PLATFORM_CONTACT_EMAIL?.trim() || null;

/**
 * Apply to become an organizer, or book a demo. Order matters: honeypot → rate limits (device, IP,
 * email) → human check → validation → store. Then a confirmation to the applicant in their language
 * and an alert to staff; a mail failure never loses the application (it is already stored).
 */
export async function applyAction(_prev: FormState, form: FormData): Promise<FormState> {
  // A hidden field only a script fills in: pretend it worked.
  if (str(form, 'fax') !== '') return success();
  const email = str(form, 'contactEmail').toLowerCase();
  const limit = await limitAction('organizerApplication', { identity: email || null });
  if (!limit.allowed) return { ok: false, code: 'rate_limited', reason: String(retryAfterMinutes(limit)) };
  if (getHumanCheck() && (await passedHumanCheck(form)) !== true)
    return { ok: false, code: 'validation_failed', fields: ['human'], reason: 'human' };
  const locale = await getLocale();
  const demo = str(form, 'kind') === 'demo';
  const time = str(form, 'preferredTime');
  let preferredTime: string | undefined;
  if (demo && time) {
    // <input type="datetime-local"> in the applicant's zone, plus that zone's offset from the browser.
    const offsetMin = Number(str(form, 'tzOffset'));
    const base = new Date(`${time}:00Z`);
    if (!Number.isNaN(base.getTime()) && Number.isFinite(offsetMin))
      preferredTime = new Date(base.getTime() + offsetMin * 60_000).toISOString();
  }
  let result: { id: string; duplicate: boolean };
  try {
    result = await submitApplication({
      kind: demo ? 'demo' : 'apply',
      orgName: str(form, 'orgName'),
      orgType: str(form, 'orgType'),
      country: str(form, 'country'),
      website: str(form, 'website'),
      contactName: str(form, 'contactName'),
      contactEmail: email,
      contactPhone: str(form, 'contactPhone'),
      eventTypes: form
        .getAll('eventTypes')
        .map(String)
        .filter((v) => (EVENT_TYPES as readonly string[]).includes(v)),
      eventsPerYear: str(form, 'eventsPerYear'),
      expectedTickets: str(form, 'expectedTickets'),
      planInterest: str(form, 'planInterest') || 'unsure',
      whiteLabel: str(form, 'whiteLabel') === 'yes',
      message: str(form, 'message'),
      preferredTime,
      timezone: str(form, 'timezone'),
      locale,
    });
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    return {
      ok: false,
      code: 'validation_failed',
      fields: [...new Set(err.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))],
    };
  }
  if (!result.duplicate)
    await notify(result.id, locale, demo, str(form, 'contactName'), str(form, 'orgName'), email);
  return success();
}

async function notify(
  id: string,
  locale: string,
  demo: boolean,
  contactName: string,
  orgName: string,
  email: string,
): Promise<void> {
  const transports = webTransports();
  if (!transports) return;
  const t = await getTranslations({ locale, namespace: 'forOrganizers.mail' });
  const send = async (to: string, subject: string, body: string) => {
    const m = renderPlainEmail({ subject, body });
    await transports.email.send({
      from: { name: 'Yayatoh', address: PLATFORM_SENDER },
      to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      headers: {},
      idempotencyKey: `application-${id}-${to}`,
    });
  };
  try {
    const subject = t(demo ? 'demoSubject' : 'applySubject');
    await send(
      email,
      subject,
      t(demo ? 'demoBody' : 'applyBody', { name: contactName.split(/\s+/)[0] ?? contactName, org: orgName }),
    );
    await logApplicantEmail(id, 'confirmation', subject);
  } catch {
    /* stored already; staff see it in the queue */
  }
  const alert = alertAddress();
  if (!alert) return;
  try {
    await send(
      alert,
      `New organizer ${demo ? 'demo request' : 'application'}: ${orgName}`,
      `${contactName} (${email}) ${demo ? 'asked for a demo' : 'applied'} for ${orgName}.\n\nReview it in the admin panel under Organizer applications.`,
    );
  } catch {
    /* the queue is the source of truth */
  }
}
