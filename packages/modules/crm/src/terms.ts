import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { recordConsentTx, upsertContactTx } from './contacts.ts';
import type { CONSENT_CHANNELS, CONSENT_PURPOSES } from './schema.ts';

/**
 * Versioned consent terms that forms ask for (M5.1b consent questions). A form's consent
 * question pins a term and the version it shows; checking it records that version in the
 * ledger. The wording itself is legal copy and lives in the app's messages
 * (`consentTerms.<term>.v<version>`); a new wording is a new version, never an edit.
 */
export const CONSENT_TERMS = {
  /** P5-8: "Exhibitors may receive my email when I let them scan my badge" (default off). */
  exhibitor_email_sharing: { channel: 'email', purpose: 'exhibitor_sharing', versions: [1] },
} as const satisfies Record<
  string,
  {
    readonly channel: (typeof CONSENT_CHANNELS)[number];
    readonly purpose: (typeof CONSENT_PURPOSES)[number];
    readonly versions: readonly number[];
  }
>;
export type ConsentTerm = keyof typeof CONSENT_TERMS;
export const CONSENT_TERM_KEYS = Object.keys(CONSENT_TERMS) as ConsentTerm[];

/** The version new consent questions show. */
export function currentTermVersion(term: ConsentTerm): number {
  return Math.max(...CONSENT_TERMS[term].versions);
}

export function isConsentTerm(term: string): term is ConsentTerm {
  return Object.hasOwn(CONSENT_TERMS, term);
}

/**
 * Record that a person agreed to a term at a version, in the caller's transaction: finds or
 * creates their contact (source `registration`) and appends a `granted` row with the version and
 * the evidence. An unknown term or version is refused (nothing is invented).
 */
export async function recordTermConsentTx(
  tx: TenantTx,
  ctx: Ctx,
  input: {
    readonly email: string;
    readonly name: string | null;
    readonly term: string;
    readonly version: number;
    readonly evidence: string;
  },
): Promise<{ contactId: string }> {
  if (
    !isConsentTerm(input.term) ||
    !(CONSENT_TERMS[input.term].versions as readonly number[]).includes(input.version)
  )
    throw new DomainError('validation_failed', 'Unknown consent term', { reason: 'consent_term' });
  const t = CONSENT_TERMS[input.term];
  const contact = await upsertContactTx(tx, ctx, {
    email: input.email,
    name: input.name,
    source: 'registration',
  });
  await recordConsentTx(tx, ctx, {
    contactId: contact.id,
    channel: t.channel,
    purpose: t.purpose,
    status: 'granted',
    evidence: input.evidence,
    version: input.version,
  });
  return { contactId: contact.id };
}
