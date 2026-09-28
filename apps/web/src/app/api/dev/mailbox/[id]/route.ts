import { PREVIEW_HEADERS, readDevMailbox } from '@yayatoh/notifications';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: one captured email's HTML, framed by /dev/mailbox. Same policy as stored previews
 * (inline styles only, no scripts, sandboxed), so the email renders as sent under the page's CSP.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!devAuthEnabled() || !/^[A-Za-z0-9-]{1,120}$/.test(id)) return new Response(null, { status: 404 });
  const entry = readDevMailbox({ id });
  if (!entry[0]?.html) return new Response(null, { status: 404 });
  return new Response(entry[0].html, { headers: PREVIEW_HEADERS });
}
