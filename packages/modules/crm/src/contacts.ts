import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  type CONSENT_CHANNELS,
  type CONSENT_PURPOSES,
  type CONSENT_STATUSES,
  type CONTACT_SOURCES,
  consents,
  contacts,
} from './schema.ts';

/** The org-unique key for a contact: trimmed, lower-cased email. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export interface UpsertContact {
  readonly email: string;
  readonly name?: string | null;
  readonly source: (typeof CONTACT_SOURCES)[number];
}

/**
 * Find or create the org's contact for an email, inside the caller's transaction. An existing
 * contact keeps its name unless it had none.
 */
export async function upsertContactTx(tx: TenantTx, ctx: Ctx, input: UpsertContact): Promise<{ id: string }> {
  const orgId = requireOrg(ctx);
  const emailNorm = normalizeEmail(input.email);
  const [row] = await tx
    .insert(contacts)
    .values({ orgId, email: input.email.trim(), emailNorm, name: input.name ?? null, source: input.source })
    .onConflictDoUpdate({
      target: [contacts.orgId, contacts.emailNorm],
      set: { name: sql`coalesce(${contacts.name}, excluded.name)`, updatedAt: ctx.now },
    })
    .returning({ id: contacts.id });
  if (!row) throw new DomainError('internal');
  return row;
}

export interface ConsentInput {
  readonly contactId: string;
  readonly channel: (typeof CONSENT_CHANNELS)[number];
  readonly purpose: (typeof CONSENT_PURPOSES)[number];
  readonly status: (typeof CONSENT_STATUSES)[number];
  readonly evidence: string;
}

export async function recordConsentTx(tx: TenantTx, ctx: Ctx, input: ConsentInput): Promise<void> {
  await tx.insert(consents).values({ orgId: requireOrg(ctx), ...input, capturedAt: ctx.now });
}

/** The current consent status, or null when none was ever recorded (which means no consent). */
export async function currentConsentTx(
  tx: TenantTx,
  contactId: string,
  channel: ConsentInput['channel'],
  purpose: ConsentInput['purpose'],
): Promise<ConsentInput['status'] | null> {
  const [row] = await tx
    .select({ status: consents.status })
    .from(consents)
    .where(
      and(eq(consents.contactId, contactId), eq(consents.channel, channel), eq(consents.purpose, purpose)),
    )
    .orderBy(desc(consents.capturedAt), desc(consents.id))
    .limit(1);
  return (row?.status as ConsentInput['status'] | undefined) ?? null;
}
