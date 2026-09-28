import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import {
  COMPLAINT_MIN_VOLUME,
  COMPLAINT_RATE_LIMIT_BPS,
  type CapCategory,
  type CapScope,
  type FrequencyCap,
} from './config.ts';

/**
 * Pure policy rules (M3.5a), unit-tested. The gate (`gate.ts`) gathers the facts from the
 * database and asks these.
 */
export type Verdict =
  | { readonly action: 'hold'; readonly until: Date; readonly reason: string }
  | { readonly action: 'block'; readonly reason: string };

/**
 * Frequency caps: `recent` are the send times of optional messages to this recipient on this
 * channel (with their category). Marketing over its cap is skipped (the moment passed); reminders
 * and event updates wait until the window has room again.
 */
export function capVerdict(input: {
  category: CapCategory;
  recent: ReadonlyArray<{ category: string; sentAt: Date }>;
  caps: Readonly<Record<CapScope, FrequencyCap>>;
  now: Date;
}): Verdict | null {
  let until: Date | null = null;
  for (const scope of [input.category, 'all'] as const) {
    const cap = input.caps[scope];
    const since = input.now.getTime() - cap.windowHours * 3_600_000;
    const inWindow = input.recent
      .filter((r) => (scope === 'all' || r.category === scope) && r.sentAt.getTime() > since)
      .map((r) => r.sentAt.getTime())
      .sort((x, y) => x - y);
    if (inWindow.length < cap.maxMessages) continue;
    if (input.category === 'marketing') return { action: 'block', reason: 'frequency_cap' };
    // Room again when the oldest message that still counts leaves the window.
    const oldest = inWindow[inWindow.length - cap.maxMessages] ?? input.now.getTime();
    const free = new Date(oldest + cap.windowHours * 3_600_000 + 1_000);
    if (!until || free > until) until = free;
  }
  return until ? { action: 'hold', until, reason: 'frequency_cap' } : null;
}

/** Complaint rate in basis points (0.01 %), rounded down. */
export const complaintRateBps = (complaints: number, sent: number) =>
  sent > 0 ? Math.floor((complaints * 10_000) / sent) : 0;

/** Strictly above 0.3 % with enough volume to judge (exactly 0.3 % does not pause). */
export function shouldAutoPause(complaints: number, sent: number): boolean {
  return sent >= COMPLAINT_MIN_VOLUME && complaints * 10_000 > sent * COMPLAINT_RATE_LIMIT_BPS;
}

/** The quota period (`YYYY-MM`, the org's calendar month) and when it ends. */
export function quotaPeriod(now: Date, timeZone: string): { period: string; resetsAt: Date } {
  const local = utcToZonedInput(now, timeZone);
  const y = Number(local.slice(0, 4));
  const m = Number(local.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { period: local.slice(0, 7), resetsAt: zonedTimeToUtc(`${next}-01T00:00`, timeZone) };
}

/**
 * WhatsApp message categories (Meta's template categories). D16: in the US only utility (and
 * authentication) messages go out; marketing templates to +1 numbers are blocked.
 */
export const WHATSAPP_CATEGORIES = ['utility', 'marketing', 'authentication'] as const;
export type WhatsAppCategory = (typeof WHATSAPP_CATEGORIES)[number];

export function whatsappVerdict(category: WhatsAppCategory, phone: string | null): Verdict | null {
  // +1 is the whole NANP; treating all of it as US is the conservative reading (pending counsel).
  if (category === 'marketing' && phone?.startsWith('+1'))
    return { action: 'block', reason: 'whatsapp_marketing_us' };
  return null;
}

/**
 * Consent for texts (SMS and WhatsApp) from the crm ledger's latest rows. Marketing needs
 * express written consent (`marketing` granted); reminders and event updates need consent to
 * informational texts (either purpose granted). A withdrawal (STOP, the preference center) wins.
 */
export function textConsentVerdict(input: {
  category: 'reminders' | 'event_updates' | 'marketing';
  marketing: string | null;
  informational: string | null;
}): Verdict | null {
  const { marketing, informational } = input;
  if (input.category === 'marketing') {
    if (marketing === 'granted') return null;
    return { action: 'block', reason: marketing === 'withdrawn' ? 'consent_withdrawn' : 'consent_missing' };
  }
  if (informational === 'granted' || (informational === null && marketing === 'granted')) return null;
  return {
    action: 'block',
    reason: informational === 'withdrawn' || marketing === 'withdrawn' ? 'consent_withdrawn' : 'consent_missing',
  };
}
