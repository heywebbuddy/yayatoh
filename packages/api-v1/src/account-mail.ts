import type { AccountUser } from '@yayatoh/auth';
import { consoleTransport, sendAccountNotice } from '@yayatoh/notifications';
import { mailTransports } from './portal-mail.ts';

/**
 * The deletion confirmation for `DELETE /v1/me`, to the old address before it is erased, as the
 * web's account page sends it: the live provider or the dev mailbox when there is one, otherwise a
 * redacted log line. Deleting an account is the person's right (App Store 5.1.1(v)), so a missing
 * mail provider never blocks it.
 */
export async function accountNotifier(to: string, user: AccountUser): Promise<void> {
  const transport = mailTransports()?.email ?? consoleTransport();
  await sendAccountNotice(transport, { to, name: user.name, locale: user.locale });
}
