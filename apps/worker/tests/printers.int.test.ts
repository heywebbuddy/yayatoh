import {
  createPrinterCommand,
  fakePrintNode,
  PRINTER_OFFLINE_EVENT,
  printerHeartbeatCommand,
  printingSetupQuery,
} from '@yayatoh/badges';
import { withTenant } from '@yayatoh/db';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { recentEventsTx } from '@yayatoh/platform';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PRINTER_WATCHDOG_MS,
  PRINTNODE_POLL_MS,
  pollPrintNode,
  runPrinterWatchdog,
  setOrgPrintNode,
} from '../src/printers.ts';

/**
 * M5.5b printer watchdog and PrintNode poll (worker): orgs are found through the SECURITY DEFINER
 * functions (platform_reader, audited); a printer silent for 90 s emits one offline event however
 * many ticks follow; PrintNode is switched on per org by staff and its printers are heard from.
 */

let a: OrgFixture;
let b: OrgFixture;
const audits: string[] = [];
let only: Set<string>;

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor, reason }) => {
    audits.push(`${actor}|${reason}`);
  });
  ({ a, b } = await twoOrgs());
  only = new Set([a.org.id, b.org.id]);
}, 120_000);

afterAll(async () => {
  await closePools();
});

const offlineEvents = async (printerId: string) =>
  (
    await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, [PRINTER_OFFLINE_EVENT], 3_600_000),
    )
  ).filter((e) => e.aggregateId === printerId);

describe('printer watchdog (M5.5b)', () => {
  it('ticks often enough: within 5 s of the 90 s line, and three PrintNode reports per window', () => {
    expect(PRINTER_WATCHDOG_MS).toBeLessThanOrEqual(5_000);
    expect(PRINTNODE_POLL_MS * 3).toBeLessThanOrEqual(90_000);
  });

  it('a printer silent for 90 s emits exactly one offline event, whatever the number of ticks', async () => {
    const p = await executeCommand(
      createPrinterCommand,
      { eventId: a.event.id, name: `Worker desk ${Date.now()}`, adapter: 'browser' },
      a.ctx(),
      ports,
    );
    const t0 = new Date();
    await executeCommand(
      printerHeartbeatCommand,
      { eventId: a.event.id, printerId: p.id },
      a.ctx({ now: t0 }),
      ports,
    );
    const at = (ms: number) => new Date(t0.getTime() + ms);
    await runPrinterWatchdog(at(85_000), only);
    expect(await offlineEvents(p.id)).toHaveLength(0);
    const r = await runPrinterWatchdog(at(90_000), only);
    expect(r.orgs).toBeGreaterThanOrEqual(1);
    expect(r.offline).toBeGreaterThanOrEqual(1);
    for (const ms of [95_000, 100_000, 400_000]) await runPrinterWatchdog(at(ms), only);
    // Two runners at the same moment never double it either.
    await Promise.all([runPrinterWatchdog(at(500_000), only), runPrinterWatchdog(at(500_000), only)]);
    expect(await offlineEvents(p.id)).toHaveLength(1);
    expect(audits).toContain('system:printer-watchdog|find orgs with silent printers');
  });

  it('PrintNode is switched on per org by staff; the poll hears its printers', async () => {
    await expect(setOrgPrintNode('no-such-org-slug', true)).rejects.toThrow(/unknown org/);
    expect(await setOrgPrintNode(b.org.slug, true)).toEqual({ orgId: b.org.id, printnodeEnabled: true });
    const p = await executeCommand(
      createPrinterCommand,
      { eventId: b.event.id, name: `Zebra ${Date.now()}`, adapter: 'printnode', printnodePrinterId: 77 },
      b.ctx(),
      ports,
    );
    const pn = fakePrintNode();
    const r = await pollPrintNode(pn, new Date(), only);
    expect(r.orgs).toBe(1);
    expect(r.heard).toBeGreaterThanOrEqual(1);
    const setup = await executeQuery(printingSetupQuery, { eventId: b.event.id }, b.ctx(), ports);
    expect(setup.printers.find((x) => x.id === p.id)?.status).toBe('online');
    expect(audits).toContain('system:printnode-poll|find orgs with PrintNode printers');
    // Switched off: the org is no longer polled.
    await setOrgPrintNode(b.org.slug, false);
    expect((await pollPrintNode(pn, new Date(), only)).orgs).toBe(0);
  });
});
