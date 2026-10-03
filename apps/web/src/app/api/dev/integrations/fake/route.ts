import {
  DEMO_BAD_RECORD,
  demoRemoteUpdate,
  eventbriteRemoteRefund,
  fakeIntegrations,
  sheetsRemoteAdd,
  sheetsRemoteDelete,
  sheetsRemoteEdit,
  sheetsRemoteList,
  sheetsRemoteRows,
} from '@yayatoh/integrations';
import { type NextRequest, NextResponse } from 'next/server';
import { integrationAuth } from '@/server/integrations.ts';
import { devAuthEnabled } from '@/server/session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const enabled = () => devAuthEnabled() && integrationAuth()?.provider === 'fake';

function accountOf(connectionId: string) {
  return UUID.test(connectionId) ? fakeIntegrations.accountFor(connectionId) : null;
}

/**
 * Dev/CI only (M6.4a, M6.4b): act at the fake provider for one of our connections, as the
 * organizer would in the provider's own app — `revoke` our access, `fix` the demo's broken record,
 * `eb-refund` an Eventbrite order, or edit the linked Google Sheet (`sheet-edit`, `sheet-add`,
 * `sheet-delete`; rows are found by their Email cell). 404 unless dev auth is on and the port is
 * the fake.
 */
export async function POST(req: NextRequest) {
  if (!enabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? '');
  const connectionId = get('connection');
  const action = get('action');
  const account = accountOf(connectionId);
  if (!account) return NextResponse.json({ error: 'unknown_connection' }, { status: 404 });
  if (action === 'revoke') fakeIntegrations.revokeAtProvider(account.authConnectionId);
  else if (action === 'fix')
    demoRemoteUpdate(account, DEMO_BAD_RECORD, {
      email_address: `fixed.${connectionId.slice(-8)}@demo-remote.test`,
    });
  else if (action === 'eb-refund') {
    if (!eventbriteRemoteRefund(account, get('order')))
      return NextResponse.json({ error: 'unknown_order' }, { status: 404 });
  } else if (action.startsWith('sheet-')) {
    // The newest sheet of the account (the one the journey linked last).
    const sheet = sheetsRemoteList(account).at(-1);
    if (!sheet) return NextResponse.json({ error: 'no_sheet' }, { status: 404 });
    const row = sheetsRemoteRows(account, sheet.id).find((r) => r.values.email === get('email'));
    const values: Record<string, string> = {};
    for (const k of ['name', 'email', 'labels']) if (form.has(`set.${k}`)) values[k] = get(`set.${k}`);
    const ok =
      action === 'sheet-add'
        ? sheetsRemoteAdd(account, sheet.id, values) !== null
        : !row
          ? false
          : action === 'sheet-edit'
            ? sheetsRemoteEdit(account, sheet.id, row.rowId, values) !== null
            : action === 'sheet-delete'
              ? sheetsRemoteDelete(account, sheet.id, row.rowId)
              : false;
    if (!ok) return NextResponse.json({ error: 'unknown_row' }, { status: 404 });
  } else return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Dev/CI only (M6.4b): the fake account's sheets and rows, as the organizer would see them. */
export async function GET(req: NextRequest) {
  if (!enabled()) return new NextResponse(null, { status: 404 });
  const account = accountOf(req.nextUrl.searchParams.get('connection') ?? '');
  if (!account) return NextResponse.json({ error: 'unknown_connection' }, { status: 404 });
  return NextResponse.json({
    sheets: sheetsRemoteList(account).map((s) => ({
      ...s,
      rows: sheetsRemoteRows(account, s.id).map((r) => ({ values: r.values })),
    })),
  });
}
