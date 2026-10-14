import { withTenant } from '@yayatoh/db';
import { createCtx, isProductionEnv } from '@yayatoh/kernel';
import {
  devMailboxTransports,
  emailIdentityTx,
  liveTransports,
  type MessageKind,
  PLATFORM_SENDER,
  renderMessage,
  type Transports,
} from '@yayatoh/notifications';
import { organizationBrandTx } from '@yayatoh/tenancy';

/** The two emails the portal's app sign-in sends: the sign-in code, and "your invitation again". */
export interface PortalMail {
  readonly kind: Extract<MessageKind, 'portal.sign-in' | 'portal.invite'>;
  readonly to: string;
  readonly locale: string;
  /** The org whose branding the email carries (null: the platform's). */
  readonly orgId: string | null;
  readonly params: Readonly<Record<string, string | number>>;
}

export type PortalMailer = (m: PortalMail) => Promise<void>;

let transports: Transports | null | undefined;

/**
 * Where the app sign-in's email goes, as for the web app's guest codes: the live provider once it
 * is switched on and configured (`EMAIL_PROVIDER=ses`), otherwise the dev mailbox outside
 * production, and nothing in production, where sending refuses to pretend. Codes are never queued
 * or stored: they leave in this request.
 */
function mailTransports(): Transports | null {
  if (transports !== undefined) return transports;
  const production = process.env.NODE_ENV === 'production' && isProductionEnv();
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.BETTER_AUTH_URL || 'http://localhost:3000';
  transports = liveTransports(process.env, origin, production ? null : devMailboxTransports());
  return transports;
}

/** The default mailer: the org's name and colour on the email, in the person's language. */
export const portalMailer: PortalMailer = async (m) => {
  const to = m.to.trim().toLowerCase();
  const [brand, identity] = m.orgId
    ? await withTenant(
        createCtx({ orgId: m.orgId, actor: { type: 'system', name: 'events.portal-mail' } }),
        async (tx) => [await organizationBrandTx(tx, m.orgId as string), await emailIdentityTx(tx)] as const,
      )
    : [null, null];
  const org = {
    name: brand?.name ?? 'Yayatoh',
    brandColor: brand?.brandColor ?? null,
    poweredByVisible: brand?.poweredByVisible ?? false,
  };
  const rendered = renderMessage({ kind: m.kind, locale: m.locale, params: m.params, org });
  const t = mailTransports();
  if (!t) throw new Error('No email provider is configured for portal sign-in codes (owner inbox: SES)');
  await t.email.send({
    from: { name: identity?.fromName ?? org.name, address: PLATFORM_SENDER },
    ...(identity?.replyTo ? { replyTo: identity.replyTo } : {}),
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {},
    idempotencyKey: `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
};
