import 'server-only';
import type { AccountUser } from '@yayatoh/auth';
import {
  consoleTransport,
  devMailboxTransports,
  type EmailTransport,
  sendAccountNotice,
} from '@yayatoh/notifications';
import { devAuthEnabled } from './dev.ts';
import { webTransports } from './mail-transports.ts';

/**
 * Where platform notices about a person's own account go (M1.14e): the live email provider (SES)
 * whenever it is configured; otherwise development and CI write to the dev mailbox and other
 * environments log a redacted line (like the sign-in codes).
 */
function noticeTransport(): EmailTransport {
  const live = webTransports()?.email;
  if (live?.name === 'ses') return live;
  if (devAuthEnabled()) return devMailboxTransports().email;
  return consoleTransport();
}

/** The deletion confirmation, to the old address before it is erased. */
export async function notifyAccountDeleted(to: string, user: AccountUser): Promise<void> {
  await sendAccountNotice(noticeTransport(), { to, name: user.name, locale: user.locale });
}
