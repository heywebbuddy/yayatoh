import {
  devPrintNode,
  pollPrintNodePrinters,
  setPrintNodeCommand,
  watchQuietPrinters,
} from '@yayatoh/badges';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M5.5b): what the worker does for printers, on demand. `op=watch` runs the printer
 * watchdog (for `printerId`s when given) with the clock `aheadMs` ahead (a station silent for 90 s without waiting 90 s);
 * `op=poll` asks the fake PrintNode about the org's printers; `op=printnode` switches PrintNode on
 * or off for the org (platform staff in production: `pnpm --filter @yayatoh/worker printnode`);
 * `op=fake-state` sets a fake PrintNode printer's state. 404 unless dev auth is on.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const op = String(form.get('op') ?? '');
  if (op === 'watch') {
    const ahead = Math.min(Math.max(Number(form.get('aheadMs') ?? 0) || 0, 0), 24 * 3_600_000);
    // `printerId` (repeatable): only those printers, so parallel e2e projects in one org don't
    // turn each other's stations offline.
    const printerIds = form
      .getAll('printerId')
      .map(String)
      .filter((v) => /^[0-9a-f-]{36}$/.test(v));
    const offline = await watchQuietPrinters(org.orgId, ports, {
      now: new Date(Date.now() + ahead),
      ...(printerIds.length ? { printerIds } : {}),
    });
    return NextResponse.json({ offline });
  }
  if (op === 'poll') return NextResponse.json(await pollPrintNodePrinters(org.orgId, ports, devPrintNode()));
  if (op === 'printnode') {
    const r = await executeCommand(
      setPrintNodeCommand,
      { enabled: form.get('enabled') === '1' },
      createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev:printnode' } }),
      ports,
    );
    return NextResponse.json(r);
  }
  if (op === 'fake-state') {
    const id = Number(form.get('printerId'));
    const state = String(form.get('state') ?? '');
    if (!Number.isInteger(id) || id < 1 || !['online', 'offline', 'rejects'].includes(state))
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    devPrintNode().setState(id, state as 'online' | 'offline' | 'rejects');
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown_op' }, { status: 400 });
}
