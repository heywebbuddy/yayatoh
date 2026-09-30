import { pool } from './client.ts';

/** A listening subscription; `close()` stops it. */
export interface Listener {
  close(): Promise<void>;
}

const CHANNEL = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * LISTEN on a Postgres notification channel as `app_user` (M1.7f live availability). One
 * dedicated connection per process carries every channel; it reconnects by itself and calls
 * `onListen` again after each (re)connect, so callers can resynchronise anything missed while it
 * was down. Payloads are whatever the notifying trigger sent: never trust them as data, only as
 * a hint of what to re-read under the tenant's RLS.
 */
export async function listenChannel(
  channel: string,
  onNotify: (payload: string) => void,
  onListen?: () => void,
): Promise<Listener> {
  if (!CHANNEL.test(channel)) throw new Error(`Invalid notification channel: ${channel}`);
  const req = await pool('app').sql.listen(channel, onNotify, onListen);
  return { close: () => req.unlisten() };
}
