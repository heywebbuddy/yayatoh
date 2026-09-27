import type { ConsoleData } from '@/server/console.ts';
import { loadInbox } from '@/server/inbox.ts';
import { InboxBell } from './inbox-bell.tsx';

/** The console bell (M1.10b): the member's inbox, loaded on the server and polled by the client. */
export async function NotificationCenter({ data }: { data: NonNullable<ConsoleData> }) {
  const initial = await loadInbox(data);
  return <InboxBell org={data.org.slug} initial={initial} />;
}
