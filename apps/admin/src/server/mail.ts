import 'server-only';
import { type AuthMailer, consoleMailer } from '@yayatoh/auth';
import { isProductionEnv } from '@yayatoh/kernel';
import {
  devMailboxTransports,
  type EmailTransport,
  liveTransports,
  type MessageKind,
  PLATFORM_SENDER,
  renderMessage,
} from '@yayatoh/notifications';

let live: EmailTransport | null | undefined;

/**
 * The live email provider (AWS SES, `EMAIL_PROVIDER=ses` with its names) for the staff console,
 * or null when it is not configured. The console sends mail at once and never queues it, so a
 * sign-in code is never stored.
 */
export function liveEmail(): EmailTransport | null {
  if (live !== undefined) return live;
  const origin = process.env.ADMIN_AUTH_URL ?? 'http://localhost:3001';
  const t = liveTransports(process.env, origin, null);
  live = t && t.email.name === 'ses' ? t.email : null;
  return live;
}

async function sendStaffAuthMail(
  kind: Extract<MessageKind, 'auth.sign-in-code' | 'auth.password-reset' | 'auth.magic-link'>,
  to: string,
  params: Readonly<Record<string, string | number>>,
): Promise<void> {
  const email = liveEmail();
  if (!email) throw new Error('No email provider is configured for staff sign-in email (EMAIL_PROVIDER=ses)');
  const rendered = renderMessage({
    kind,
    locale: 'en',
    params,
    org: { name: 'Yayatoh', brandColor: null, poweredByVisible: false },
  });
  await email.send({
    from: { name: 'Yayatoh', address: PLATFORM_SENDER },
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {},
    idempotencyKey: `staff-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
}

/**
 * Staff sign-in mail: the live provider whenever it is configured (always in production, where
 * the console mailer refuses so a code or link is never written to a log); otherwise development
 * keeps the console mailer. Code 10 min, link 15, reset 30, as on the web.
 */
export const staffMailer: AuthMailer = {
  async sendOtp(to, otp, purpose) {
    if (liveEmail() || isProductionEnv())
      return sendStaffAuthMail('auth.sign-in-code', to, { code: otp, minutes: 10 });
    await consoleMailer.sendOtp(to, otp, purpose);
  },
  async sendMagicLink(to, url) {
    if (liveEmail() || isProductionEnv())
      return sendStaffAuthMail('auth.magic-link', to, { url, minutes: 15 });
    await consoleMailer.sendMagicLink(to, url);
  },
  async sendPasswordReset(to, url) {
    if (liveEmail() || isProductionEnv())
      return sendStaffAuthMail('auth.password-reset', to, { url, minutes: 30 });
    await consoleMailer.sendPasswordReset?.(to, url);
  },
};

let devMailbox: EmailTransport | undefined;

/**
 * A one-off email from the staff console (organizer applications: invitations, decisions): the
 * live provider when it is configured; the dev mailbox (read at /dev/mailbox on the web app) in
 * development and CI; never silently dropped in production, where it throws instead.
 */
export async function sendConsoleMail(m: {
  to: string;
  subject: string;
  html: string;
  text: string;
  key: string;
}): Promise<void> {
  const transport = liveEmail() ?? (isProductionEnv() ? null : (devMailbox ??= devMailboxTransports().email));
  if (!transport) throw new Error('No email provider is configured (EMAIL_PROVIDER=ses)');
  await transport.send({
    from: { name: 'Yayatoh', address: PLATFORM_SENDER },
    to: m.to,
    subject: m.subject,
    html: m.html,
    text: m.text,
    headers: {},
    idempotencyKey: m.key,
  });
}
