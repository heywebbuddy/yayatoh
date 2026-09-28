import { getUsersByIds } from '@yayatoh/auth';
import { withPlatformReader } from '@yayatoh/db/platform';
import {
  type DispatchDeps,
  devMailboxTransports,
  dispatchDue,
  fakeDeliverySecret,
  type Transports,
} from '@yayatoh/notifications';
import { sql } from 'drizzle-orm';

/**
 * The channel adapters for this environment. Real providers (SES, Twilio, FCM v1, APNs, VAPID)
 * arrive with the owner's accounts (docs/owner-inbox.md). Until then development and preview
 * write to the dev mailbox; production refuses to pretend and leaves messages queued.
 */
export function workerTransports(env: NodeJS.ProcessEnv = process.env): Transports | null {
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') return null;
  // The fake provider's delivery reports wait in the mailbox for the dev drain (M1.10d).
  return devMailboxTransports(undefined, { deliverySecret: fakeDeliverySecret(env) });
}

export const userEmails: NonNullable<DispatchDeps['userEmails']> = async (ids) =>
  new Map([...(await getUsersByIds(ids))].map(([id, u]) => [id, u.email]));

/** Members' email languages (M1.10d): member notifications render in them. */
export const userLocales: NonNullable<DispatchDeps['userLocales']> = async (ids) =>
  new Map([...(await getUsersByIds(ids))].map(([id, u]) => [id, u.locale]));

/**
 * One dispatcher tick (leader only): find orgs with due messages through a SECURITY DEFINER
 * function, then send per org under that org's RLS. A second tick or machine running at the
 * same time is harmless: rows are claimed with SKIP LOCKED.
 */
export async function dispatchNotifications(deps: DispatchDeps): Promise<number> {
  const orgs = await withPlatformReader(
    { actor: 'system:notifications', reason: 'find orgs with due messages' },
    (tx) => tx.execute<{ org_id: string }>(sql`select org_id from notifications.orgs_with_due_messages(100)`),
  );
  let sent = 0;
  for (const { org_id } of orgs) sent += (await dispatchDue(org_id, deps, 100)).sent;
  return sent;
}
