import type { TenantTx } from '@yayatoh/db';
import { and, desc, eq } from 'drizzle-orm';
import type { ConsentInput } from './contacts.ts';
import { consents } from './schema.ts';

/**
 * The latest consent row (status and the wording version agreed to) of a contact for a channel
 * and purpose, or null when none was ever recorded (which means no consent). M5.6b stamps a lead
 * with the version under which an email was shared.
 */
export async function currentConsentEntryTx(
  tx: TenantTx,
  contactId: string,
  channel: ConsentInput['channel'],
  purpose: ConsentInput['purpose'],
): Promise<{ status: ConsentInput['status']; version: number | null; capturedAt: Date } | null> {
  const [row] = await tx
    .select({ status: consents.status, version: consents.version, capturedAt: consents.capturedAt })
    .from(consents)
    .where(
      and(eq(consents.contactId, contactId), eq(consents.channel, channel), eq(consents.purpose, purpose)),
    )
    .orderBy(desc(consents.capturedAt), desc(consents.id))
    .limit(1);
  return row
    ? { status: row.status as ConsentInput['status'], version: row.version, capturedAt: row.capturedAt }
    : null;
}
