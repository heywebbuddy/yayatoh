import { getUsersByIds } from '@yayatoh/auth';
import { sendStaffAlertPushes } from '@yayatoh/checkin';
import { withPlatformReader } from '@yayatoh/db/platform';
import {
  type DispatchDeps,
  devMailboxTransports,
  dispatchDue,
  fakeDeliverySecret,
  type Transports,
  vapidConfig,
  withWebPush,
} from '@yayatoh/notifications';
import { sql } from 'drizzle-orm';

/**
 * The channel adapters for this environment. Real providers (SES, Twilio, FCM v1, APNs, VAPID)
 * arrive with the owner's accounts (docs/owner-inbox.md). Until then development and preview
 * write to the dev mailbox; production refuses to pretend and leaves messages queued.
 */
export function workerTransports(
  env: NodeJS.ProcessEnv = process.env,
  appOrigin = env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000',
): Transports | null {
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') return null;
  // The fake provider's delivery reports wait in the mailbox for the dev drain (M1.10d). Web push
  // (M1.10e) uses the real adapter with the dev VAPID keys; with dev auth on, the fake push service
  // on the app's origin is reachable too.
  return withWebPush(devMailboxTransports(undefined, { deliverySecret: fakeDeliverySecret(env) }), {
    vapid: vapidConfig(env),
    appOrigin,
    fakeOrigin: env.YAYATOH_DEV_AUTH === '1' ? appOrigin : null,
  });
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

/**
 * Staff alert pushes (M3.4a): orgs with queued pushes (SECURITY DEFINER, ids only), then each
 * org's pushes under its RLS. Rows are claimed with SKIP LOCKED, so overlapping ticks are harmless.
 */
export async function dispatchStaffPushes(transports: Transports): Promise<number> {
  const push = transports.push;
  if (!push) return 0;
  const orgs = await withPlatformReader(
    { actor: 'system:staff-push', reason: 'find orgs with staff alert pushes to send' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`select org_id from checkin.orgs_with_queued_staff_pushes(100)`),
  );
  let sent = 0;
  for (const { org_id } of orgs)
    sent += (await sendStaffAlertPushes(org_id, { send: (m) => push.send(m) })).sent;
  return sent;
}
