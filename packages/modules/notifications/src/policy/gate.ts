import { createHmac } from 'node:crypto';
import { consentSummaryTx, normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { appTokenSecret } from '@yayatoh/platform';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { type KindDefinition, whatsappCategoryOf } from '../kinds.ts';
import { frequencyCaps, messages, quotaLimits, usageCounters } from '../schema.ts';
import {
  CAP_CATEGORIES,
  CAP_SCOPES,
  type CapCategory,
  type CapScope,
  DEFAULT_CAPS,
  DEFAULT_MONTHLY_QUOTAS,
  type FrequencyCap,
  QUOTA_CHANNELS,
  QUOTA_RECHECK_MS,
  type QuotaChannel,
} from './config.ts';
import { capVerdict, quotaPeriod, textConsentVerdict, type Verdict, whatsappVerdict } from './rules.ts';
import { applicableStateRules } from './state-rules.ts';
import { nextAllowedInstant } from './windows.ts';

/**
 * Policy gate v2 (M3.5a). The dispatcher's M1.10 checks (kill switch, address suppressions,
 * unsubscribes, preferences, federal quiet hours) stay where they are; these rules are registered
 * here and run in two phases so other increments can add theirs without touching the loop:
 *
 * - `eligibility` (before quiet hours): may this message be sent at all? A `block` marks it
 *   `suppressed` with the rule's reason, which the organizer sees in the message log.
 * - `timing` (after federal quiet hours): may it go now? A `hold` keeps it queued until then.
 *
 * Rules see one message and a per-dispatch state (quota usage, caps) loaded once per org.
 */
type Row = typeof messages.$inferSelect;

export type PolicyPhase = 'eligibility' | 'timing';

export interface GateFacts {
  readonly tx: TenantTx;
  readonly orgId: string;
  readonly row: Row;
  readonly def: KindDefinition;
  readonly now: Date;
  /** E.164 for SMS and WhatsApp (decrypted from the params), else null. */
  readonly phone: string | null;
  readonly orgTimeZone: string;
  readonly ignoreQuietHours: boolean;
  readonly state: GateState;
}

export interface PolicyRule {
  readonly name: string;
  readonly phase: PolicyPhase;
  check(facts: GateFacts): Promise<Verdict | null>;
}

/** Categories that are the recipient's own choice or the org's own alerts: no text consent needed. */
const TEXT_CONSENT_CATEGORIES = ['reminders', 'event_updates', 'marketing'] as const;
const TEXT_CHANNELS = new Set(['sms', 'whatsapp']);
/** Quotas never hold these: tickets, receipts and links, and members' own alerts. */
const QUOTA_EXEMPT = new Set(['transactional', 'sales', 'messages']);

const isConsentCategory = (c: string): c is (typeof TEXT_CONSENT_CATEGORIES)[number] =>
  (TEXT_CONSENT_CATEGORIES as readonly string[]).includes(c);

/**
 * Texts (SMS, WhatsApp) need consent in the crm ledger: express written consent for marketing,
 * consent to informational texts for reminders and updates. Marketing email needs marketing
 * consent too. Transactional messages and members' alerts are not gated here.
 */
export const consentRule: PolicyRule = {
  name: 'consent',
  phase: 'eligibility',
  async check({ tx, row }) {
    const text = TEXT_CHANNELS.has(row.channel);
    const marketingEmail = row.channel === 'email' && row.category === 'marketing' && row.recipientEmail;
    if (!isConsentCategory(row.category) || !(text || marketingEmail)) return null;
    if (!row.contactId) return { action: 'block', reason: 'consent_missing' };
    const ledger = await consentSummaryTx(tx, row.contactId);
    const status = (purpose: string) => ledger.get(`${row.channel}:${purpose}`)?.status ?? null;
    if (!text) {
      const m = status('marketing');
      return m === 'granted'
        ? null
        : { action: 'block', reason: m === 'withdrawn' ? 'consent_withdrawn' : 'consent_missing' };
    }
    return textConsentVerdict({
      category: row.category,
      marketing: status('marketing'),
      informational: status('informational'),
    });
  },
};

/** D16: WhatsApp marketing templates never go to US numbers (utility and authentication do). */
export const whatsappCategoryRule: PolicyRule = {
  name: 'whatsapp_category',
  phase: 'eligibility',
  async check({ row, phone }) {
    if (row.channel !== 'whatsapp') return null;
    return whatsappVerdict(whatsappCategoryOf(row.kind), phone);
  },
};

/** State calling-hour statutes (Texas Sundays, Florida/Oklahoma 8 p.m., …) for non-urgent texts. */
export const stateQuietHoursRule: PolicyRule = {
  name: 'state_quiet_hours',
  phase: 'timing',
  async check({ row, def, phone, now, ignoreQuietHours }) {
    if (!TEXT_CHANNELS.has(row.channel) || def.urgent || ignoreQuietHours) return null;
    const checks = applicableStateRules({ phone, region: row.recipientRegion }).flatMap(({ rule, zones }) =>
      zones.map((zone) => ({ zone, windows: rule.allowed })),
    );
    if (checks.length === 0) return null;
    const until = nextAllowedInstant(now, checks);
    return until ? { action: 'hold', until, reason: 'state_quiet_hours' } : null;
  },
};

/** Frequency caps per recipient per category, and across the org's optional messages. */
export const frequencyCapRule: PolicyRule = {
  name: 'frequency_cap',
  phase: 'timing',
  async check({ tx, row, now, state }) {
    if (!row.recipientKey || !(CAP_CATEGORIES as readonly string[]).includes(row.category)) return null;
    const caps = await state.caps(tx);
    const longest = Math.max(...Object.values(caps).map((c) => c.windowHours));
    const recent = await tx
      .select({ category: messages.category, sentAt: messages.sentAt })
      .from(messages)
      .where(
        and(
          eq(messages.status, 'sent'),
          eq(messages.recipientKey, row.recipientKey),
          inArray(messages.category, [...CAP_CATEGORIES]),
          isNotNull(messages.sentAt),
          gt(messages.sentAt, new Date(now.getTime() - longest * 3_600_000)),
        ),
      );
    return capVerdict({
      category: row.category as CapCategory,
      recent: recent.map((r) => ({ category: r.category, sentAt: r.sentAt as Date })),
      caps,
      now,
    });
  },
};

/** Monthly quotas (D16 cost recovery): over the limit, optional messages wait — never dropped. */
export const quotaRule: PolicyRule = {
  name: 'quota',
  phase: 'timing',
  async check({ tx, row, now, state }) {
    if (QUOTA_EXEMPT.has(row.category)) return null;
    const channel = row.channel as QuotaChannel;
    const q = await state.quota(tx, channel);
    if (q.used < q.limit) return null;
    return {
      action: 'hold',
      until: new Date(Math.min(now.getTime() + QUOTA_RECHECK_MS, q.resetsAt.getTime())),
      reason: 'quota_reached',
    };
  },
};

/** The registered rules, in order within each phase. Add new rules here. */
export const POLICY_RULES: readonly PolicyRule[] = [
  consentRule,
  whatsappCategoryRule,
  stateQuietHoursRule,
  frequencyCapRule,
  quotaRule,
];

/** Run one phase: the first rule with a verdict decides. */
export async function runPolicyPhase(
  phase: PolicyPhase,
  facts: GateFacts,
  rules: readonly PolicyRule[] = POLICY_RULES,
): Promise<Verdict | null> {
  for (const rule of rules) {
    if (rule.phase !== phase) continue;
    const v = await rule.check(facts);
    if (v) return v;
  }
  return null;
}

/** Per-dispatch state: the org's caps and quota usage, loaded once, updated as messages go out. */
export interface GateState {
  caps(tx: TenantTx): Promise<Readonly<Record<CapScope, FrequencyCap>>>;
  quota(tx: TenantTx, channel: QuotaChannel): Promise<{ used: number; limit: number; resetsAt: Date }>;
  /** Count a sent message (SMS: its segments) against the period. */
  meter(tx: TenantTx, channel: QuotaChannel, units: number): Promise<void>;
}

export async function orgCapsTx(tx: TenantTx): Promise<Record<CapScope, FrequencyCap>> {
  const rows = await tx.select().from(frequencyCaps);
  const caps = { ...DEFAULT_CAPS } as Record<CapScope, FrequencyCap>;
  for (const r of rows)
    if ((CAP_SCOPES as readonly string[]).includes(r.scope))
      caps[r.scope as CapScope] = { maxMessages: r.maxMessages, windowHours: r.windowHours };
  return caps;
}

export async function orgQuotaLimitsTx(tx: TenantTx): Promise<Record<QuotaChannel, number>> {
  const rows = await tx.select().from(quotaLimits);
  const limits = { ...DEFAULT_MONTHLY_QUOTAS } as Record<QuotaChannel, number>;
  for (const r of rows)
    if ((QUOTA_CHANNELS as readonly string[]).includes(r.channel))
      limits[r.channel as QuotaChannel] = r.monthlyLimit;
  return limits;
}

export async function usageTx(
  tx: TenantTx,
  period: string,
): Promise<Record<QuotaChannel, { messages: number; units: number }>> {
  const rows = await tx.select().from(usageCounters).where(eq(usageCounters.period, period));
  const out = Object.fromEntries(QUOTA_CHANNELS.map((c) => [c, { messages: 0, units: 0 }])) as Record<
    QuotaChannel,
    { messages: number; units: number }
  >;
  for (const r of rows)
    if ((QUOTA_CHANNELS as readonly string[]).includes(r.channel))
      out[r.channel as QuotaChannel] = { messages: r.messages, units: r.units };
  return out;
}

export function createGateState(orgId: string, orgTimeZone: string, now: Date): GateState {
  const { period, resetsAt } = quotaPeriod(now, orgTimeZone);
  let caps: Record<CapScope, FrequencyCap> | null = null;
  let limits: Record<QuotaChannel, number> | null = null;
  let usage: Record<QuotaChannel, { messages: number; units: number }> | null = null;
  return {
    async caps(tx) {
      caps ??= await orgCapsTx(tx);
      return caps;
    },
    async quota(tx, channel) {
      limits ??= await orgQuotaLimitsTx(tx);
      usage ??= await usageTx(tx, period);
      return { used: usage[channel].units, limit: limits[channel], resetsAt };
    },
    async meter(tx, channel, units) {
      await tx
        .insert(usageCounters)
        .values({ orgId, period, channel, messages: 1, units })
        .onConflictDoUpdate({
          target: [usageCounters.orgId, usageCounters.period, usageCounters.channel],
          set: {
            messages: sql`${usageCounters.messages} + 1`,
            units: sql`${usageCounters.units} + ${units}`,
            updatedAt: now,
          },
        });
      if (usage)
        usage[channel] = { messages: usage[channel].messages + 1, units: usage[channel].units + units };
    },
  };
}

/**
 * The recipient key frequency caps count by: an HMAC of (channel, address) under APP_TOKEN_SECRET,
 * so no readable phone column is needed. Null when the secret is missing (caps then skip).
 */
export function recipientKey(channel: string, address: string | null | undefined): string | null {
  if (!address) return null;
  const norm = channel === 'email' && address.includes('@') ? normalizeEmail(address) : address.trim();
  try {
    return createHmac('sha256', appTokenSecret())
      .update(`notifications.recipient:${channel}:${norm}`)
      .digest('base64url');
  } catch {
    return null;
  }
}
