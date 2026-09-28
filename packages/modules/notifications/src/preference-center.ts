import {
  consentSummaryTx,
  contactByIdTx,
  contactIdByEmailTx,
  normalizeEmail,
  recordConsentTx,
  setContactPhoneTx,
} from '@yayatoh/crm';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { signLinkToken, tenantCommand, verifyLinkToken } from '@yayatoh/platform';
import { organizationNameTx } from '@yayatoh/tenancy';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { maskPhone } from './policy/console.ts';
import { suppressions } from './schema.ts';
import { maskEmail } from './unsubscribe.ts';

/**
 * The recipient's preference center (M3.5a), per org: which categories arrive by email, and
 * whether texts (SMS, WhatsApp) come at all, for reminders and updates or also for news and
 * offers. No account needed: the link is an HMAC over the contact id bound to the org, reached
 * from the unsubscribe page. One-click unsubscribe (RFC 8058) is unchanged.
 *
 * Email categories are the unsubscribe list (`suppressions`); consents to texts and to marketing
 * email are rows in the crm consent ledger with their evidence (what was shown, when, which
 * number), so the gate can prove express written consent before a marketing text.
 */
export const PREFERENCES_PURPOSE = 'notifications.preferences';
/** The disclosure shown next to the text-message boxes (bump when its wording changes). */
export const TEXT_DISCLOSURE_VERSION = 'text-consent-v1';

export const EMAIL_PREF_CATEGORIES = ['reminders', 'event_updates', 'marketing'] as const;
export const TEXT_PREF_CHANNELS = ['sms', 'whatsapp'] as const;
export const TEXT_PREF_PURPOSES = ['informational', 'marketing'] as const;

const purposeOf = (orgId: string) => `${PREFERENCES_PURPOSE}:${orgId}`;

/** The preference-center path for a contact of an org (`/preferences/{org}/{token}`). */
export function preferencesPath(orgId: string, contactId: string): string {
  return `/preferences/${orgId}/${signLinkToken(purposeOf(orgId), contactId)}`;
}

/** The contact id if the token is authentic for this org, else null. */
export function preferencesRef(orgId: string, token: string): string | null {
  if (!/^[0-9a-f-]{36}$/.test(orgId) || token.length > 200) return null;
  return verifyLinkToken(purposeOf(orgId), token);
}

export const PreferenceCenterDto = z.object({
  orgName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  emailCategories: z.object({ reminders: z.boolean(), event_updates: z.boolean(), marketing: z.boolean() }),
  sms: z.object({ informational: z.boolean(), marketing: z.boolean() }),
  whatsapp: z.object({ informational: z.boolean(), marketing: z.boolean() }),
});
export type PreferenceCenterDto = z.infer<typeof PreferenceCenterDto>;

async function stateTx(tx: TenantTx, orgId: string, contactId: string): Promise<PreferenceCenterDto | null> {
  const contact = await contactByIdTx(tx, contactId);
  if (!contact) return null;
  const emailNorm = normalizeEmail(contact.email);
  const off = new Set(
    (
      await tx
        .select({ category: suppressions.category })
        .from(suppressions)
        .where(eq(suppressions.emailNorm, emailNorm))
    ).map((r) => r.category),
  );
  const ledger = await consentSummaryTx(tx, contactId);
  const granted = (channel: string, purpose: string) =>
    ledger.get(`${channel}:${purpose}`)?.status === 'granted';
  return {
    orgName: (await organizationNameTx(tx, orgId)) ?? '',
    email: maskEmail(contact.email),
    phone: contact.phoneE164 ? maskPhone(contact.phoneE164) : null,
    emailCategories: {
      reminders: !off.has('reminders'),
      event_updates: !off.has('event_updates'),
      // Marketing email needs a yes in the ledger, and no unsubscribe since.
      marketing: !off.has('marketing') && granted('email', 'marketing'),
    },
    sms: { informational: granted('sms', 'informational'), marketing: granted('sms', 'marketing') },
    whatsapp: {
      informational: granted('whatsapp', 'informational'),
      marketing: granted('whatsapp', 'marketing'),
    },
  };
}

/** What the preference center shows (masked addresses), or null for a bad link. */
export async function preferenceCenterInfo(
  orgId: string,
  token: string,
): Promise<PreferenceCenterDto | null> {
  const contactId = preferencesRef(orgId, token);
  if (!contactId) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'notifications.preferences' } });
  return withTenant(ctx, async (tx) => {
    const s = await stateTx(tx, orgId, contactId);
    return s ? PreferenceCenterDto.parse(s) : null;
  });
}

/** The preference-center path for an email address of the org, when it is a known contact. */
export async function preferencesPathForEmailTx(tx: TenantTx, orgId: string, email: string) {
  const contactId = await contactIdByEmailTx(tx, email);
  return contactId ? preferencesPath(orgId, contactId) : null;
}

export const E164 = /^\+[1-9][0-9]{6,14}$/;
/** Spaces, dots, dashes and brackets are dropped; the rest must be E.164. */
export const normalizePhone = (raw: string) => raw.replace(/[\s().-]/g, '');

const Choices = z.object({ informational: z.boolean(), marketing: z.boolean() });

/**
 * Save the preference center. Open to whoever holds the link (like unsubscribe). Changes only:
 * a box that did not change writes nothing, so the ledger's evidence stays the original consent.
 * A new number re-records the text consents that are on (the evidence names the number).
 */
export const savePreferenceCenterCommand = tenantCommand({
  name: 'notifications.savePreferenceCenter',
  input: z.object({
    token: z.string().min(10).max(200),
    emailCategories: z.object({ reminders: z.boolean(), event_updates: z.boolean(), marketing: z.boolean() }),
    /** A new number, or null to keep the current one. */
    phone: z.string().trim().max(32).nullable(),
    sms: Choices,
    whatsapp: Choices,
  }),
  output: z.object({ changed: z.int() }),
  entitlement: null,
  permission: 'public:preferences',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const contactId = preferencesRef(orgId, input.token);
    if (!contactId) throw new DomainError('not_found', 'Unknown link');
    const before = await stateTx(tx, orgId, contactId);
    const contact = await contactByIdTx(tx, contactId);
    if (!before || !contact) throw new DomainError('not_found', 'Unknown link');
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (phone && !E164.test(phone))
      throw new DomainError('validation_failed', 'Enter the number with its country code', {
        reason: 'invalid_phone',
      });
    const number = phone ?? contact.phoneE164;
    const wantsTexts = TEXT_PREF_CHANNELS.some((c) => input[c].informational || input[c].marketing);
    if (wantsTexts && !number)
      throw new DomainError('validation_failed', 'A mobile number is needed for texts', {
        reason: 'phone_required',
      });
    const newNumber = Boolean(phone && phone !== contact.phoneE164);
    const changes: string[] = [];

    for (const category of EMAIL_PREF_CATEGORIES) {
      const want = input.emailCategories[category];
      if (want === before.emailCategories[category]) continue;
      changes.push(`email:${category}:${want ? 'on' : 'off'}`);
      const emailNorm = normalizeEmail(contact.email);
      if (want)
        await tx
          .delete(suppressions)
          .where(and(eq(suppressions.emailNorm, emailNorm), inArray(suppressions.category, [category])));
      else
        await tx
          .insert(suppressions)
          .values({ orgId, emailNorm, category, source: 'page' })
          .onConflictDoNothing();
      if (category === 'marketing')
        await recordConsentTx(tx, ctx, {
          contactId,
          channel: 'email',
          purpose: 'marketing',
          status: want ? 'granted' : 'withdrawn',
          evidence: `preference_center:${TEXT_DISCLOSURE_VERSION}:email`,
        });
    }
    if (newNumber && phone) {
      await setContactPhoneTx(tx, ctx, contactId, phone);
      changes.push('phone');
    }
    for (const channel of TEXT_PREF_CHANNELS)
      for (const purpose of TEXT_PREF_PURPOSES) {
        const want = input[channel][purpose];
        const was = before[channel][purpose];
        if (want === was && !(want && newNumber)) continue;
        changes.push(`${channel}:${purpose}:${want ? 'on' : 'off'}`);
        await recordConsentTx(tx, ctx, {
          contactId,
          channel,
          purpose,
          status: want ? 'granted' : 'withdrawn',
          // Express written consent: the disclosure version, the channel and the number's last digits.
          evidence: `preference_center:${TEXT_DISCLOSURE_VERSION}:${channel}:${purpose}:${(number ?? '').slice(-4)}`,
        });
      }
    return { changed: changes.length, contactId, changes };
  },
  present: (r) => ({ changed: r.changed }),
  audit: (_input, r) => ({
    action: 'notifications.preference_center',
    targetType: 'contact',
    targetId: r.contactId,
    data: { changes: r.changes },
  }),
});
