import {
  archivePrinterCommand,
  assignTemplateCommand,
  badgePrintStateQuery,
  browserJobBadgeQuery,
  createPrinterCommand,
  createTemplateCommand,
  fakePrintNode,
  markQuietPrintersCommand,
  PRINTER_OFFLINE_EVENT,
  PRINTER_ONLINE_EVENT,
  type PrintJobDto,
  pollPrintNodePrinters,
  printerHeartbeatCommand,
  printingSetupQuery,
  printLogQuery,
  recordPrinterStatesCommand,
  recordPrintResultCommand,
  sendPrintJob,
  setPrintNodeCommand,
  startPrintJobCommand,
  watchQuietPrinters,
} from '@yayatoh/badges';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import type { PdfRenderer } from '@yayatoh/pdf';
import { recentEventsTx } from '@yayatoh/platform';
import { badgeTicketsTx, createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.5b printing: printers per event, print jobs and the print log (every print and reprint with
 * its reason), the BadgePrinter port (browser hand-off, the fake PrintNode), the printer heartbeat
 * and the watchdog (a printer silent for 90 s emits exactly one offline event), permissions and
 * tenant isolation.
 */

let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;
let other: EventDto;
let ga: string;
const viewer = () => userCtx(a.viewerId, a.org.id);

const renderer: PdfRenderer = {
  async render({ html }) {
    return new TextEncoder().encode(`%PDF-${html.length}`);
  },
};

const expectRefused = async (p: Promise<unknown>, code = 'forbidden', reason?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (reason) expect((err as DomainError).details).toMatchObject({ reason });
  return err as DomainError;
};

async function newEvent(name: string) {
  return executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T14:00:00Z',
      endsAt: '2030-06-02T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
}

/** A free ticket for `name`; returns its id. */
async function ticketFor(name: string): Promise<string> {
  const tag = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  await executeCommand(
    startCheckoutCommand,
    {
      eventId: ev.id,
      items: [{ ticketTypeId: ga, quantity: 1 }],
      buyer: { email: `p${tag}@printing.test`, name },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const tickets = await withTenant(a.ctx(), (tx) => badgeTicketsTx(tx, { eventId: ev.id }));
  const t = tickets.filter((x) => x.holderName === name).at(-1);
  if (!t) throw new Error(`no ticket for ${name}`);
  return t.id;
}

let n = 0;
const print = (ctx: Ctx, input: Record<string, unknown>) => {
  n += 1;
  return executeCommand(
    startPrintJobCommand,
    { eventId: ev.id, requestKey: `print-${Date.now()}-${n}`, ...input },
    ctx,
    ports,
  );
};

const printerEvents = async (printerId: string) =>
  (
    await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, [PRINTER_OFFLINE_EVENT, PRINTER_ONLINE_EVENT], 3_600_000),
    )
  ).filter((e) => e.aggregateId === printerId);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await newEvent(`Print Summit ${a.org.slug}`);
  other = await newEvent(`Other Summit ${a.org.slug}`);
  ga = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId: ev.id, name: 'General Admission', priceMinor: 0, quantityTotal: 500 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
  const tpl = await executeCommand(
    createTemplateCommand,
    { eventId: ev.id, name: 'Attendee', size: 'fold_4x3' },
    a.ctx(),
    ports,
  );
  await executeCommand(
    assignTemplateCommand,
    { eventId: ev.id, ticketTypeId: ga, templateId: tpl.id },
    a.ctx(),
    ports,
  );
}, 180_000);

afterAll(async () => {
  await closePools();
});

describe('printers per event', () => {
  it('an organizer adds a browser printer; the name is unique per event; viewers are refused', async () => {
    const p = await executeCommand(
      createPrinterCommand,
      { eventId: ev.id, name: 'Front desk', adapter: 'browser' },
      a.ctx(),
      ports,
    );
    expect(p).toMatchObject({ name: 'Front desk', adapter: 'browser', status: 'unknown', lastSeenAt: null });
    await expectRefused(
      executeCommand(
        createPrinterCommand,
        { eventId: ev.id, name: 'front DESK', adapter: 'browser' },
        a.ctx(),
        ports,
      ),
      'conflict',
      'name_taken',
    );
    // Another event may use the same name.
    await executeCommand(
      createPrinterCommand,
      { eventId: other.id, name: 'Front desk', adapter: 'browser' },
      a.ctx(),
      ports,
    );
    await expectRefused(
      executeCommand(
        createPrinterCommand,
        { eventId: ev.id, name: 'Viewer desk', adapter: 'browser' },
        viewer(),
        ports,
      ),
    );
    await expectRefused(
      executeCommand(createPrinterCommand, { eventId: ev.id, name: '', adapter: 'browser' }, a.ctx(), ports),
      'validation_failed',
    );
  });

  it('PrintNode printers need PrintNode switched on (platform staff only) and a PrintNode printer id', async () => {
    await expectRefused(
      executeCommand(
        createPrinterCommand,
        { eventId: ev.id, name: 'Zebra 1', adapter: 'printnode', printnodePrinterId: 71 },
        a.ctx(),
        ports,
      ),
      'invalid_state',
      'printnode_off',
    );
    // An org owner cannot switch it on themselves.
    await expectRefused(executeCommand(setPrintNodeCommand, { enabled: true }, a.ctx(), ports));
    await executeCommand(setPrintNodeCommand, { enabled: true }, systemCtx(a.org.id), ports);
    await expectRefused(
      executeCommand(
        createPrinterCommand,
        { eventId: ev.id, name: 'Zebra 1', adapter: 'printnode' },
        a.ctx(),
        ports,
      ),
      'validation_failed',
      'printnode_id_required',
    );
    const p = await executeCommand(
      createPrinterCommand,
      { eventId: ev.id, name: 'Zebra 1', adapter: 'printnode', printnodePrinterId: 71 },
      a.ctx(),
      ports,
    );
    expect(p).toMatchObject({ adapter: 'printnode', printnodePrinterId: 71 });
    const setup = await executeQuery(printingSetupQuery, { eventId: ev.id }, viewer(), ports);
    expect(setup.printnodeEnabled).toBe(true);
    expect(setup.printers.map((x) => x.name)).toEqual(expect.arrayContaining(['Front desk', 'Zebra 1']));
  });

  it('archiving hides a printer, frees its name and refuses new prints to it', async () => {
    const p = await executeCommand(
      createPrinterCommand,
      { eventId: ev.id, name: 'Spare', adapter: 'browser' },
      a.ctx(),
      ports,
    );
    await expectRefused(
      executeCommand(archivePrinterCommand, { eventId: ev.id, printerId: p.id }, viewer(), ports),
    );
    const archived = await executeCommand(
      archivePrinterCommand,
      { eventId: ev.id, printerId: p.id },
      a.ctx(),
      ports,
    );
    expect(archived.archived).toBe(true);
    const setup = await executeQuery(printingSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(setup.printers.find((x) => x.id === p.id)).toBeUndefined();
    const all = await executeQuery(
      printingSetupQuery,
      { eventId: ev.id, includeArchived: true },
      a.ctx(),
      ports,
    );
    expect(all.printers.find((x) => x.id === p.id)?.archived).toBe(true);
    await executeCommand(
      createPrinterCommand,
      { eventId: ev.id, name: 'Spare', adapter: 'browser' },
      a.ctx(),
      ports,
    );
    const t = await ticketFor('Archie Vance');
    await expectRefused(print(a.ctx(), { ticketId: t, printerId: p.id }), 'invalid_state', 'archived');
  });
});

describe('print log: every print and reprint with its reason (acceptance)', () => {
  it('logs the first print, refuses a reprint without a reason, and logs each reprint with its reason', async () => {
    const t = await ticketFor('Ada Lovelace');
    const desk = (await executeQuery(printingSetupQuery, { eventId: ev.id }, a.ctx(), ports)).printers.find(
      (x) => x.name === 'Front desk',
    );
    const before = await executeQuery(badgePrintStateQuery, { eventId: ev.id, ticketId: t }, a.ctx(), ports);
    expect(before).toMatchObject({
      holderName: 'Ada Lovelace',
      prints: 0,
      nextKind: 'print',
      hasTemplate: true,
    });

    const first = await print(a.ctx(), { ticketId: t, printerId: desk?.id, source: 'attendee_page' });
    expect(first).toMatchObject({
      kind: 'print',
      reason: 'first_print',
      status: 'sent',
      adapter: 'browser',
      source: 'attendee_page',
    });
    // A first print takes no reason.
    const t2 = await ticketFor('Grace Hopper');
    await expectRefused(
      print(a.ctx(), { ticketId: t2, reason: 'damaged' }),
      'validation_failed',
      'reason_not_allowed',
    );

    // A reprint needs one.
    await expectRefused(print(a.ctx(), { ticketId: t }), 'validation_failed', 'reason_required');
    await expectRefused(
      print(a.ctx(), { ticketId: t, reason: 'other' }),
      'validation_failed',
      'note_required',
    );
    const damaged = await print(a.ctx(), { ticketId: t, reason: 'damaged' });
    const other = await print(a.ctx(), { ticketId: t, reason: 'other', note: 'Coffee on the lanyard' });
    expect(damaged).toMatchObject({ kind: 'reprint', reason: 'damaged', printerId: null });
    expect(other).toMatchObject({ kind: 'reprint', reason: 'other', note: 'Coffee on the lanyard' });

    const log = await executeQuery(printLogQuery, { eventId: ev.id, ticketId: t }, viewer(), ports);
    expect(log.entries.map((e) => [e.kind, e.reason, e.holderName])).toEqual([
      ['reprint', 'other', 'Ada Lovelace'],
      ['reprint', 'damaged', 'Ada Lovelace'],
      ['print', 'first_print', 'Ada Lovelace'],
    ]);
    expect(log.entries.at(-1)?.printerName).toBe('Front desk');
    expect(log).toMatchObject({ prints: 1, reprints: 2 });
    const after = await executeQuery(badgePrintStateQuery, { eventId: ev.id, ticketId: t }, a.ctx(), ports);
    expect(after).toMatchObject({ prints: 3, nextKind: 'reprint' });
    expect(after.lastPrintedAt).not.toBeNull();
  });

  it('is idempotent per request key (a double submit logs once)', async () => {
    const t = await ticketFor('Idem Potent');
    const key = `print-idem-${Date.now()}`;
    const one = await print(a.ctx(), { ticketId: t, requestKey: key });
    const two = await print(a.ctx(), { ticketId: t, requestKey: key });
    expect(two.id).toBe(one.id);
    const log = await executeQuery(printLogQuery, { eventId: ev.id, ticketId: t }, a.ctx(), ports);
    expect(log.entries).toHaveLength(1);
  });

  it('refuses viewers, voided tickets, printers of another event and foreign orgs', async () => {
    const t = await ticketFor('Refused Rita');
    await expectRefused(print(viewer(), { ticketId: t }));
    await expectRefused(executeQuery(badgePrintStateQuery, { eventId: ev.id, ticketId: t }, viewer(), ports));
    const elsewhere = (await executeQuery(printingSetupQuery, { eventId: other.id }, a.ctx(), ports))
      .printers[0];
    await expectRefused(print(a.ctx(), { ticketId: t, printerId: elsewhere?.id }), 'not_found');
    // Org B sees nothing of org A's event, tickets or log.
    await expectRefused(print(b.ctx(), { ticketId: t }), 'not_found');
    await expectRefused(executeQuery(printLogQuery, { eventId: ev.id }, b.ctx(), ports), 'not_found');
    await expectRefused(executeQuery(printingSetupQuery, { eventId: ev.id }, b.ctx(), ports), 'not_found');
    const own = await executeQuery(printLogQuery, { eventId: b.event.id }, b.ctx(), ports);
    expect(own.entries.every((e) => e.eventId === b.event.id)).toBe(true);
    // A voided ticket has no badge to print.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update ticketing.tickets set status = 'void', void_reason = 'refunded' where id = ${t}`),
    );
    await expectRefused(print(a.ctx(), { ticketId: t }), 'not_found');
  });

  it('a browser job opens its badge PDF for 30 minutes; a PrintNode job never does', async () => {
    const t = await ticketFor('Paper Trail');
    const job = await print(a.ctx(), { ticketId: t });
    const badge = await executeQuery(browserJobBadgeQuery, { jobId: job.id }, a.ctx(), ports);
    expect(badge.html).toContain('Paper');
    expect(badge.title).toContain('Paper Trail');
    const later = a.ctx({ now: new Date(Date.now() + 31 * 60_000) });
    await expectRefused(
      executeQuery(browserJobBadgeQuery, { jobId: job.id }, later, ports),
      'not_found',
      'expired',
    );
    await expectRefused(executeQuery(browserJobBadgeQuery, { jobId: job.id }, viewer(), ports));
    await expectRefused(executeQuery(browserJobBadgeQuery, { jobId: job.id }, b.ctx(), ports), 'not_found');
  });
});

describe('PrintNode jobs through the port (fake)', () => {
  it('hands a queued job to PrintNode once, and a refused job is failed and does not count', async () => {
    const pn = fakePrintNode();
    const zebra = (await executeQuery(printingSetupQuery, { eventId: ev.id }, a.ctx(), ports)).printers.find(
      (x) => x.name === 'Zebra 1',
    );
    const t = await ticketFor('Silent Sam');
    const job = await print(a.ctx(), { ticketId: t, printerId: zebra?.id });
    expect(job).toMatchObject({ status: 'queued', adapter: 'printnode', kind: 'print' });
    const sent = await sendPrintJob({ ports, renderer, printNode: pn }, a.ctx(), job.id);
    expect(sent).toMatchObject({ status: 'sent' });
    expect(pn.jobs).toHaveLength(1);
    expect(pn.jobs[0]).toMatchObject({ orgId: a.org.id, printerId: 71 });
    expect(pn.jobs[0]?.title).toContain('Silent Sam');
    // Sending again changes nothing (the job is no longer queued).
    await expectRefused(sendPrintJob({ ports, renderer, printNode: pn }, a.ctx(), job.id), 'invalid_state');
    expect(pn.jobs).toHaveLength(1);

    pn.setState(71, 'rejects');
    const t2 = await ticketFor('Refused Rosa');
    const job2 = await print(a.ctx(), { ticketId: t2, printerId: zebra?.id });
    const failed = await sendPrintJob({ ports, renderer, printNode: pn }, a.ctx(), job2.id);
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'printer_rejected' });
    // The failed job is in the log, and the next attempt is still a first print.
    const again = await print(a.ctx(), { ticketId: t2 });
    expect(again.kind).toBe('print');
    const log = await executeQuery(printLogQuery, { eventId: ev.id, ticketId: t2 }, a.ctx(), ports);
    expect(log.entries.map((e) => e.status)).toEqual(['sent', 'failed']);
  });

  it('without a renderer or PrintNode the job fails with a code', async () => {
    const zebra = (await executeQuery(printingSetupQuery, { eventId: ev.id }, a.ctx(), ports)).printers.find(
      (x) => x.name === 'Zebra 1',
    );
    const t = await ticketFor('No Renderer');
    const j1: PrintJobDto = await print(a.ctx(), { ticketId: t, printerId: zebra?.id });
    expect(
      await sendPrintJob({ ports, renderer: null, printNode: fakePrintNode() }, a.ctx(), j1.id),
    ).toMatchObject({
      status: 'failed',
      errorCode: 'renderer_unavailable',
    });
    const j2 = await print(a.ctx(), { ticketId: t, printerId: zebra?.id });
    expect(await sendPrintJob({ ports, renderer, printNode: null }, a.ctx(), j2.id)).toMatchObject({
      status: 'failed',
      errorCode: 'printnode_unavailable',
    });
    // A result recorded twice changes nothing.
    const again = await executeCommand(
      recordPrintResultCommand,
      { jobId: j2.id, ok: true, providerJobId: '1' },
      a.ctx(),
      ports,
    );
    expect(again.status).toBe('failed');
  });
});

describe('printer heartbeat and the offline event (acceptance)', () => {
  it('a printer silent for 90 s emits exactly one offline event per silence', async () => {
    const p = await executeCommand(
      createPrinterCommand,
      { eventId: ev.id, name: `Station ${Date.now()}`, adapter: 'browser' },
      a.ctx(),
      ports,
    );
    // Never heard from: no offline event, however long it stays silent.
    expect(await watchQuietPrinters(a.org.id, ports, { now: new Date(Date.now() + 600_000) })).not.toContain(
      p.id,
    );

    const t0 = new Date();
    const hb = await executeCommand(
      printerHeartbeatCommand,
      { eventId: ev.id, printerId: p.id },
      a.ctx({ now: t0 }),
      ports,
    );
    expect(hb).toEqual({ status: 'online', cameOnline: true });
    const at = (ms: number) => new Date(t0.getTime() + ms);
    expect(await watchQuietPrinters(a.org.id, ports, { now: at(89_000) })).not.toContain(p.id);
    expect(await watchQuietPrinters(a.org.id, ports, { now: at(90_000) })).toContain(p.id);
    // Later ticks (or a second runner) find nothing more.
    expect(await watchQuietPrinters(a.org.id, ports, { now: at(91_000) })).not.toContain(p.id);
    expect(await watchQuietPrinters(a.org.id, ports, { now: at(300_000) })).not.toContain(p.id);

    const setup = await executeQuery(printingSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    const row = setup.printers.find((x) => x.id === p.id);
    expect(row).toMatchObject({ status: 'offline' });
    expect(row?.offlineAt?.toISOString()).toBe(at(90_000).toISOString());

    let events = await printerEvents(p.id);
    expect(events.map((e) => e.type)).toEqual([PRINTER_ONLINE_EVENT, PRINTER_OFFLINE_EVENT]);
    expect(events[1]?.payload).toEqual({
      orgId: a.org.id,
      eventId: ev.id,
      printerId: p.id,
      adapter: 'browser',
      lastSeenAt: t0.toISOString(),
      offlineAt: at(90_000).toISOString(),
    });

    // Back online (one online event), then silent again: a second offline event.
    await executeCommand(
      printerHeartbeatCommand,
      { eventId: ev.id, printerId: p.id },
      a.ctx({ now: at(400_000) }),
      ports,
    );
    await executeCommand(
      printerHeartbeatCommand,
      { eventId: ev.id, printerId: p.id },
      a.ctx({ now: at(420_000) }),
      ports,
    );
    expect(await watchQuietPrinters(a.org.id, ports, { now: at(500_000) })).not.toContain(p.id);
    expect(await watchQuietPrinters(a.org.id, ports, { now: at(510_000) })).toContain(p.id);
    events = await printerEvents(p.id);
    expect(events.map((e) => e.type)).toEqual([
      PRINTER_ONLINE_EVENT,
      PRINTER_OFFLINE_EVENT,
      PRINTER_ONLINE_EVENT,
      PRINTER_OFFLINE_EVENT,
    ]);
  });

  it('the dev drain can watch only some printers (parallel stations in one org stay apart)', async () => {
    const mk = async (name: string) =>
      executeCommand(
        createPrinterCommand,
        { eventId: ev.id, name: `${name} ${Date.now()}`, adapter: 'browser' },
        a.ctx(),
        ports,
      );
    const [p1, p2] = [await mk('Mine'), await mk('Theirs')];
    const t0 = new Date();
    for (const p of [p1, p2])
      await executeCommand(
        printerHeartbeatCommand,
        { eventId: ev.id, printerId: p.id },
        a.ctx({ now: t0 }),
        ports,
      );
    const later = new Date(t0.getTime() + 95_000);
    expect(await watchQuietPrinters(a.org.id, ports, { now: later, printerIds: [p1.id] })).toEqual([p1.id]);
    expect(await watchQuietPrinters(a.org.id, ports, { now: later })).toContain(p2.id);
  });

  it('heartbeats need attendees:write, a live station printer of the event, and stay in the org', async () => {
    const p = await executeCommand(
      createPrinterCommand,
      { eventId: ev.id, name: `Guarded ${Date.now()}`, adapter: 'browser' },
      a.ctx(),
      ports,
    );
    await expectRefused(
      executeCommand(printerHeartbeatCommand, { eventId: ev.id, printerId: p.id }, viewer(), ports),
    );
    await expectRefused(
      executeCommand(printerHeartbeatCommand, { eventId: b.event.id, printerId: p.id }, b.ctx(), ports),
      'not_found',
    );
    const zebra = (await executeQuery(printingSetupQuery, { eventId: ev.id }, a.ctx(), ports)).printers.find(
      (x) => x.adapter === 'printnode',
    );
    await expectRefused(
      executeCommand(printerHeartbeatCommand, { eventId: ev.id, printerId: zebra?.id ?? '' }, a.ctx(), ports),
      'invalid_state',
      'not_a_station',
    );
    await executeCommand(archivePrinterCommand, { eventId: ev.id, printerId: p.id }, a.ctx(), ports);
    await expectRefused(
      executeCommand(printerHeartbeatCommand, { eventId: ev.id, printerId: p.id }, a.ctx(), ports),
      'invalid_state',
      'archived',
    );
    // The watchdog and the PrintNode report are platform steps: an org member cannot run them.
    await expectRefused(executeCommand(markQuietPrintersCommand, {}, a.ctx(), ports));
    await expectRefused(
      executeCommand(
        recordPrinterStatesCommand,
        { states: [{ printerId: p.id, state: 'online' }] },
        a.ctx(),
        ports,
      ),
    );
  });

  it('PrintNode printers are heard from through the poll; a printer PrintNode reports offline goes quiet', async () => {
    const pn = fakePrintNode();
    const mk = (name: string, id: number) =>
      executeCommand(
        createPrinterCommand,
        { eventId: ev.id, name, adapter: 'printnode', printnodePrinterId: id },
        a.ctx(),
        ports,
      );
    const up = await mk(`PN up ${Date.now()}`, 501);
    const down = await mk(`PN down ${Date.now()}`, 502);
    pn.setState(502, 'offline');
    const t0 = new Date();
    const r = await pollPrintNodePrinters(a.org.id, ports, pn, { now: t0 });
    expect(r.heard).toBeGreaterThanOrEqual(1);
    const setup = await executeQuery(printingSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(setup.printers.find((x) => x.id === up.id)?.status).toBe('online');
    expect(setup.printers.find((x) => x.id === down.id)?.status).toBe('unknown');
    // 60 s later PrintNode loses the first one too: 90 s after its last report it is offline, once.
    pn.setState(501, 'offline');
    await pollPrintNodePrinters(a.org.id, ports, pn, { now: new Date(t0.getTime() + 60_000) });
    expect(await watchQuietPrinters(a.org.id, ports, { now: new Date(t0.getTime() + 89_999) })).not.toContain(
      up.id,
    );
    expect(await watchQuietPrinters(a.org.id, ports, { now: new Date(t0.getTime() + 90_000) })).toContain(
      up.id,
    );
    expect((await printerEvents(up.id)).filter((e) => e.type === PRINTER_OFFLINE_EVENT)).toHaveLength(1);
    expect(await printerEvents(down.id)).toHaveLength(0);
  });
});
