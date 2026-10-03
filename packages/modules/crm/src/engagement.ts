import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { normalizeEmail } from './contacts.ts';
import { contacts, eventEngagement } from './schema.ts';

/**
 * M5.7b: the contact behind a signed-in account, for counting what they do in a live session.
 * The account's link (`user_id`) first, else its email; merged contacts are never returned.
 */
export async function contactForAccountTx(
  tx: TenantTx,
  account: { readonly userId: string; readonly email: string },
): Promise<string | null> {
  const [linked] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, account.userId), isNull(contacts.mergedInto)))
    .limit(1);
  if (linked) return linked.id;
  const [byEmail] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.emailNorm, normalizeEmail(account.email)), isNull(contacts.mergedInto)))
    .limit(1);
  return byEmail?.id ?? null;
}

/**
 * Replace the engagement scores of these contacts at one event (or of everyone there, with
 * `contactIds: null`): rows listed are upserted, the others in that set are removed. The
 * `engagement` module computes the scores; crm only keeps them for segments.
 */
export async function replaceEventEngagementTx(
  tx: TenantTx,
  ctx: Ctx,
  v: {
    readonly eventId: string;
    readonly contactIds: readonly string[] | null;
    readonly rows: readonly { readonly contactId: string; readonly score: number }[];
  },
): Promise<void> {
  const orgId = requireOrg(ctx);
  const keep = v.rows.map((r) => r.contactId);
  const scope = and(
    eq(eventEngagement.eventId, v.eventId),
    v.contactIds === null ? undefined : inArray(eventEngagement.contactId, [...v.contactIds, ...keep]),
    keep.length ? notInArray(eventEngagement.contactId, keep) : undefined,
  );
  if (v.contactIds === null || v.contactIds.length > 0 || keep.length > 0)
    await tx.delete(eventEngagement).where(scope);
  if (v.rows.length === 0) return;
  await tx
    .insert(eventEngagement)
    .values(
      v.rows.map((r) => ({
        orgId,
        eventId: v.eventId,
        contactId: r.contactId,
        score: r.score,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })),
    )
    .onConflictDoUpdate({
      target: [eventEngagement.orgId, eventEngagement.contactId, eventEngagement.eventId],
      set: { score: sql`excluded.score`, updatedAt: ctx.now },
    });
}
