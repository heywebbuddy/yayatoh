import type { TenantTx } from '@yayatoh/db';
import { uuidv7 } from '@yayatoh/kernel';
import { asc, eq } from 'drizzle-orm';
import { inboxItems, preferences, pushTokens } from './schema.ts';
import { renderAccountNotice } from './templates/render.ts';
import { type EmailTransport, PLATFORM_SENDER } from './transports.ts';

/** A member's saved notification choices in the current org (their account export, M1.14e). */
export async function userPreferencesTx(tx: TenantTx, userId: string) {
  return tx
    .select({ category: preferences.category, channel: preferences.channel, enabled: preferences.enabled })
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .orderBy(asc(preferences.category), asc(preferences.channel));
}

/**
 * The account is being deleted (M1.14e): its notification choices, device push tokens and inbox
 * in the current org are deleted. The message log keeps its rows (delivery evidence).
 */
export async function eraseUserNotificationsTx(tx: TenantTx, userId: string) {
  const p = await tx
    .delete(preferences)
    .where(eq(preferences.userId, userId))
    .returning({ id: preferences.id });
  const t = await tx.delete(pushTokens).where(eq(pushTokens.userId, userId)).returning({ id: pushTokens.id });
  const i = await tx.delete(inboxItems).where(eq(inboxItems.userId, userId)).returning({ id: inboxItems.id });
  return { preferences: p.length, pushTokens: t.length, inboxItems: i.length };
}

/**
 * Send a platform notice about the person's own account (M1.14e: the deletion confirmation, to
 * the old address before it is erased), in their email language, from the platform sender.
 */
export async function sendAccountNotice(
  transport: EmailTransport,
  input: { readonly to: string; readonly name?: string | null; readonly locale?: string | null },
): Promise<void> {
  const r = renderAccountNotice({ notice: 'deleted', locale: input.locale, name: input.name });
  await transport.send({
    from: { name: 'Yayatoh', address: PLATFORM_SENDER },
    to: input.to,
    subject: r.subject,
    html: r.html,
    text: r.text,
    headers: { 'X-Yayatoh-Notice': 'account.deleted' },
    idempotencyKey: uuidv7(),
  });
}
