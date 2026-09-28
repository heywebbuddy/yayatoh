import 'server-only';
import type { AccountUser } from '@yayatoh/auth';
import {
  consoleTransport,
  devMailboxTransports,
  type EmailTransport,
  sendAccountNotice,
} from '@yayatoh/notifications';
import { devAuthEnabled } from './dev.ts';

/**
 * Where platform notices about a person's own account go (M1.14e). The email provider (SES) is an
 * owner account still pending; until then development and CI write to the dev mailbox and other
 * environments log a redacted line (like the sign-in codes).
 */
function noticeTransport(): EmailTransport {
  if (devAuthEnabled()) return devMailboxTransports().email;
  return consoleTransport();
}

/** The deletion confirmation, to the old address before it is erased. */
export async function notifyAccountDeleted(to: string, user: AccountUser): Promise<void> {
  await sendAccountNotice(noticeTransport(), { to, name: user.name, locale: user.locale });
}
