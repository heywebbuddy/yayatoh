'use server';

import { renderPlainEmail } from '@yayatoh/applications';
import { platformContactSettings, submitPlatformContactMessage } from '@yayatoh/cms';
import { PLATFORM_SENDER } from '@yayatoh/notifications';
import { getLocale, getTranslations } from 'next-intl/server';
import { ZodError } from 'zod';
import type { FormState } from '@/lib/form-state.ts';
import { success } from '@/server/form.ts';
import { getHumanCheck, passedHumanCheck } from '@/server/human-check.ts';
import { webTransports } from '@/server/mail-transports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

const str = (form: FormData, k: string) => String(form.get(k) ?? '').trim();

/**
 * The Contact page form. Order matters: honeypot → rate limits (device, IP, sender address) →
 * human check → validation → store in the staff inbox (Contact messages in the admin console).
 * Then an alert to the platform's support address and a confirmation to the sender in their
 * language; a mail failure never loses the message (it is stored already).
 */
export async function contactAction(_prev: FormState, form: FormData): Promise<FormState> {
  // A hidden field only a script fills in: pretend it worked.
  if (str(form, 'fax') !== '') return success();
  const email = str(form, 'email').toLowerCase();
  const limit = await limitAction('contactRequest', { identity: email || null });
  if (!limit.allowed) return { ok: false, code: 'rate_limited', reason: String(retryAfterMinutes(limit)) };
  if (getHumanCheck() && (await passedHumanCheck(form)) !== true)
    return { ok: false, code: 'validation_failed', fields: ['human'], reason: 'human' };
  const locale = await getLocale();
  const name = str(form, 'name');
  const subject = str(form, 'subject');
  const message = str(form, 'message');
  let id: string;
  try {
    id = await submitPlatformContactMessage({ name, email, subject, message, locale });
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    return {
      ok: false,
      code: 'validation_failed',
      fields: [...new Set(err.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))],
    };
  }
  await notify({ id, locale, name, email, subject, message });
  return success();
}

async function notify(m: {
  id: string;
  locale: string;
  name: string;
  email: string;
  subject: string;
  message: string;
}): Promise<void> {
  const transports = webTransports();
  if (!transports) return;
  const t = await getTranslations({ locale: m.locale, namespace: 'sitePages.contact.mail' });
  const send = async (to: string, subject: string, body: string, replyTo?: string) => {
    const r = renderPlainEmail({ subject, body });
    await transports.email.send({
      from: { name: 'Yayatoh', address: PLATFORM_SENDER },
      to,
      subject: r.subject,
      html: r.html,
      text: r.text,
      headers: replyTo ? { 'Reply-To': replyTo } : {},
      idempotencyKey: `contact-${m.id}-${to}`,
    });
  };
  try {
    await send(
      m.email,
      t('confirmSubject'),
      t('confirmBody', { name: m.name.split(/\s+/)[0] ?? m.name, subject: m.subject }),
    );
  } catch {
    /* stored already; staff see it in the inbox */
  }
  const settings = await platformContactSettings().catch(() => null);
  const alert =
    settings?.supportEmail.trim() || process.env.PLATFORM_CONTACT_EMAIL?.trim() || 'support@yayatoh.com';
  try {
    await send(
      alert,
      `Contact message: ${m.subject}`,
      `${m.name} (${m.email}) wrote:\n\n${m.message}\n\nReply from the admin panel under Contact messages.`,
      m.email,
    );
  } catch {
    /* stored already */
  }
}
