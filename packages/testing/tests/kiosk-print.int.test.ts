import {
  assignTemplateCommand,
  createPrinterCommand,
  createTemplateCommand,
  fakePrintNode,
  KioskBadgeDto,
  kioskJobBadgeQuery,
  kioskLookupQuery,
  kioskPrintCommand,
  kioskRequestCodeCommand,
  kioskSettingsQuery,
  kioskSnapshotQuery,
  kioskVerifyCodeCommand,
  printLogQuery,
  sendPrintJob,
  setKioskSettingsCommand,
  setPrintNodeCommand,
  startPrintJobCommand,
  type WaitingRegistrationLookup,
} from '@yayatoh/badges';
import { deviceContext, enrollDeviceCommand, startKioskCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import type { PdfRenderer } from '@yayatoh/pdf';
import { hasWaitingRegistrationTx } from '@yayatoh/registration';
import { badgeTicketsTx, createTicketTypeCommand, setOrderPaymentDueTx } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.5c kiosk self-print: a kiosk identifies one attendee by possession (their ticket's code or an
 * emailed one-time code), shows only that attendee's badge details, and prints the badge once; a
 * balance due, a waiting registration, a reprint or a missing template go to the desk. Kiosk
 * commands run as the device and only on a kiosk at that event with self-print on.
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

async function newEvent(name: string, f = a) {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T14:00:00Z',
      endsAt: '2030-06-02T23:00:00Z',
    },
    f.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, f.ctx(), ports);
  return e;
}

interface Issued {
  id: string;
  orderId: string;
  code: string;
  shortCode: string;
  email: string;
}

let seq = 0;
/** A free ticket for `name` (held at `email`, unique by default) on `typeId`. */
async function ticketFor(name: string, opts: { typeId?: string; email?: string; eventId?: string } = {}) {
  seq += 1;
  const email = opts.email ?? `k${Date.now()}${seq}@kiosk.test`;
  const eventId = opts.eventId ?? ev.id;
  await executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: opts.typeId ?? ga, quantity: 1 }], buyer: { email, name } },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const tickets = await withTenant(a.ctx(), (tx) => badgeTicketsTx(tx, { eventId }));
  const t = tickets.filter((x) => x.holderName === name).at(-1);
  if (!t) throw new Error(`no ticket for ${name}`);
  const [row] = await withTenant(a.ctx(), (tx) =>
    tx.execute<{ short_code: string }>(sql`select short_code from ticketing.tickets where id = ${t.id}`),
  );
  return { id: t.id, orderId: t.orderId, code: t.code, shortCode: row?.short_code ?? '', email } as Issued;
}

/** An enrolled device; `kiosk` puts it in kiosk mode at the event. */
async function device(label: string, opts: { kioskAt?: string; f?: OrgFixture } = {}) {
  const f = opts.f ?? a;
  const { token, deviceId } = await executeCommand(enrollDeviceCommand, { label }, f.ctx(), ports);
  if (opts.kioskAt)
    await executeCommand(
      startKioskCommand,
      { eventId: opts.kioskAt, deviceId, checkpointId: null, pin: '2468' },
      f.ctx(),
      ports,
    );
  const dc = await deviceContext(token);
  if (!dc) throw new Error('device did not resolve');
  return { deviceId, ctx: (): Ctx => createCtx({ orgId: f.org.id, actor: dc.ctx.actor }) };
}

let kiosk: Awaited<ReturnType<typeof device>>;
let kiosk2: Awaited<ReturnType<typeof device>>;

let keyN = 0;
const key = () => `kiosk-${Date.now()}-${++keyN}`;
const lookup = (ctx: Ctx, code: string, eventId = ev.id) =>
  executeQuery(kioskLookupQuery, { eventId, code }, ctx, ports);
const kprint = (ctx: Ctx, input: { ticketId: string; pass?: string; code?: string; requestKey?: string }) =>
  executeCommand(kioskPrintCommand, { eventId: ev.id, requestKey: key(), ...input }, ctx, ports);
const jobsOf = async (ticketId: string) =>
  (await executeQuery(printLogQuery, { eventId: ev.id, ticketId, limit: 50 }, a.ctx(), ports)).entries;

let waitingAnswer = false;
const waiting: WaitingRegistrationLookup = async (tx, eventId, email) =>
  waitingAnswer || (await hasWaitingRegistrationTx(tx, eventId, email));
const requestCode = kioskRequestCodeCommand(waiting);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await newEvent(`Kiosk Summit ${a.org.slug}`);
  other = await newEvent(`Other Summit ${a.org.slug}`);
  const type = (eventId: string, name: string) =>
    executeCommand(
      createTicketTypeCommand,
      { eventId, name, priceMinor: 0, quantityTotal: 500 },
      a.ctx(),
      ports,
    );
  ga = (await type(ev.id, 'General Admission')).id;
  await type(other.id, 'General Admission');
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
  kiosk = await device('Lobby kiosk', { kioskAt: ev.id });
  kiosk2 = await device('Hall kiosk', { kioskAt: ev.id });
  await executeCommand(setKioskSettingsCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
}, 180_000);

afterAll(async () => {
  await closePools();
});

describe('kiosk self-print settings', () => {
  it('are off by default; organizers turn them on; viewers read but cannot change', async () => {
    expect(await executeQuery(kioskSettingsQuery, { eventId: other.id }, a.ctx(), ports)).toEqual({
      eventId: other.id,
      enabled: false,
      printerId: null,
      emailCodes: true,
    });
    expect(await executeQuery(kioskSettingsQuery, { eventId: ev.id }, viewer(), ports)).toMatchObject({
      enabled: true,
    });
    await expectRefused(
      executeCommand(setKioskSettingsCommand, { eventId: ev.id, enabled: false }, viewer(), ports),
    );
  });

  it('refuse a printer of another event, and another org sees nothing', async () => {
    const elsewhere = await executeCommand(
      createPrinterCommand,
      { eventId: other.id, name: 'Other desk', adapter: 'browser' },
      a.ctx(),
      ports,
    );
    await expectRefused(
      executeCommand(
        setKioskSettingsCommand,
        { eventId: ev.id, enabled: true, printerId: elsewhere.id },
        a.ctx(),
        ports,
      ),
      'not_found',
    );
    await expectRefused(executeQuery(kioskSettingsQuery, { eventId: ev.id }, b.ctx(), ports), 'not_found');
  });
});

describe('identifying at the kiosk', () => {
  it("shows the scanned ticket's badge details only: allowlisted fields, no email or code", async () => {
    const t = await ticketFor('Amina Diallo');
    for (const code of [t.code, t.shortCode, t.shortCode.toLowerCase()]) {
      const r = await lookup(kiosk.ctx(), code);
      expect(r).toMatchObject({
        ticketId: t.id,
        name: 'Amina Diallo',
        typeName: 'General Admission',
        status: 'ready',
      });
      expect(Object.keys(r).sort()).toEqual([...Object.keys(KioskBadgeDto.shape), 'pass'].sort());
      expect(JSON.stringify(r)).not.toContain(t.email);
      expect(JSON.stringify(r)).not.toContain(t.code);
    }
  });

  it('refuses unknown codes, another event’s and another org’s tickets', async () => {
    await expectRefused(lookup(kiosk.ctx(), 'NOPE-NOPE'), 'not_found');
    const elsewhere = await ticketFor('Other Event Guest', {
      eventId: other.id,
      typeId: (
        await withTenant(a.ctx(), (tx) =>
          tx.execute<{ id: string }>(
            sql`select id from ticketing.ticket_types where event_id = ${other.id} limit 1`,
          ),
        )
      )[0]?.id as string,
    });
    await expectRefused(lookup(kiosk.ctx(), elsewhere.shortCode), 'not_found');
    // A's ticket codes mean nothing to B's kiosk (B has its own event).
    const bEvent = await newEvent(`B Summit ${b.org.slug}`, b);
    const bKiosk = await device('B kiosk', { kioskAt: bEvent.id, f: b });
    await executeCommand(setKioskSettingsCommand, { eventId: bEvent.id, enabled: true }, b.ctx(), ports);
    const t = await ticketFor('Isolation Guest');
    await expectRefused(lookup(bKiosk.ctx(), t.shortCode, bEvent.id), 'not_found');
    // …and B's kiosk can't ask about A's event at all.
    await expectRefused(lookup(bKiosk.ctx(), t.shortCode, ev.id), 'forbidden', 'not_kiosk');
  });

  it('only a kiosk at this event with self-print on: scanners, members and other events are refused', async () => {
    const t = await ticketFor('Gate Keeper');
    const scanner = await device('Door scanner');
    await expectRefused(lookup(scanner.ctx(), t.shortCode), 'forbidden', 'not_kiosk');
    await expectRefused(lookup(a.ctx(), t.shortCode), 'forbidden');
    const elsewhere = await device('Other kiosk', { kioskAt: other.id });
    await expectRefused(lookup(elsewhere.ctx(), t.shortCode), 'forbidden', 'not_kiosk');
    await executeCommand(setKioskSettingsCommand, { eventId: other.id, enabled: false }, a.ctx(), ports);
    await expectRefused(lookup(elsewhere.ctx(), t.shortCode, other.id), 'forbidden', 'kiosk_print_off');
  });
});

describe('printing at the kiosk', () => {
  it('prints once: the job is logged as a kiosk first print; another try says printed; a retry is the same job', async () => {
    const t = await ticketFor('Bola Ade');
    const { pass } = await lookup(kiosk.ctx(), t.shortCode);
    const requestKey = key();
    const r = await kprint(kiosk.ctx(), { ticketId: t.id, pass, requestKey });
    expect(r).toMatchObject({ status: 'printing', adapter: 'browser', queued: false });
    const again = await kprint(kiosk.ctx(), { ticketId: t.id, pass, requestKey });
    expect(again).toEqual(r);
    expect(await kprint(kiosk.ctx(), { ticketId: t.id, pass })).toEqual({ status: 'printed' });
    expect(await lookup(kiosk.ctx(), t.shortCode)).toMatchObject({ status: 'printed' });
    const jobs = await jobsOf(t.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source: 'kiosk', kind: 'print', reason: 'first_print', status: 'sent' });
    // The desk still reprints it, with a reason.
    const desk = await executeCommand(
      startPrintJobCommand,
      { eventId: ev.id, ticketId: t.id, reason: 'damaged', requestKey: key() },
      a.ctx(),
      ports,
    );
    expect(desk).toMatchObject({ kind: 'reprint', source: 'desk' });
  });

  it('two kiosks (or a double tap) at once log exactly one print', async () => {
    const t = await ticketFor('Chen Wei');
    const p1 = (await lookup(kiosk.ctx(), t.shortCode)).pass;
    const p2 = (await lookup(kiosk2.ctx(), t.code)).pass;
    const results = await Promise.all([
      kprint(kiosk.ctx(), { ticketId: t.id, pass: p1 }),
      kprint(kiosk2.ctx(), { ticketId: t.id, pass: p2 }),
      kprint(kiosk.ctx(), { ticketId: t.id, pass: p1 }),
    ]);
    expect(results.filter((r) => r.status === 'printing')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'printed')).toHaveLength(2);
    expect(await jobsOf(t.id)).toHaveLength(1);
  });

  it('needs proof for that ticket on that kiosk: its pass, or the ticket’s own code (offline queue)', async () => {
    const t = await ticketFor('Dana Ruiz');
    const u = await ticketFor('Eli Stone');
    const { pass } = await lookup(kiosk.ctx(), u.shortCode);
    await expectRefused(kprint(kiosk.ctx(), { ticketId: t.id }), 'forbidden', 'not_identified');
    await expectRefused(kprint(kiosk.ctx(), { ticketId: t.id, pass }), 'forbidden', 'not_identified');
    await expectRefused(kprint(kiosk2.ctx(), { ticketId: u.id, pass }), 'forbidden', 'not_identified');
    await expectRefused(
      kprint(kiosk.ctx(), { ticketId: t.id, code: u.shortCode }),
      'forbidden',
      'not_identified',
    );
    await expectRefused(kprint(kiosk.ctx(), { ticketId: t.id, pass: `${pass}x` }), 'forbidden');
    expect(await kprint(kiosk.ctx(), { ticketId: t.id, code: t.code })).toMatchObject({ status: 'printing' });
    expect(await jobsOf(u.id)).toHaveLength(0);
  });

  it('sends a balance due and a badge without a template to the desk, logging nothing', async () => {
    const due = await ticketFor('Faye Owed');
    await withTenant(a.ctx(), (tx) => setOrderPaymentDueTx(tx, due.orderId, true, new Date()));
    const d = await lookup(kiosk.ctx(), due.shortCode);
    expect(d.status).toBe('desk');
    expect(await kprint(kiosk.ctx(), { ticketId: due.id, pass: d.pass })).toEqual({ status: 'desk' });
    // The other event has no badge template at all.
    const otherType = (
      await withTenant(a.ctx(), (tx) =>
        tx.execute<{ id: string }>(
          sql`select id from ticketing.ticket_types where event_id = ${other.id} limit 1`,
        ),
      )
    )[0]?.id as string;
    const otherKiosk = await device('No-template kiosk', { kioskAt: other.id });
    await executeCommand(setKioskSettingsCommand, { eventId: other.id, enabled: true }, a.ctx(), ports);
    const vol = await ticketFor('Gus Helper', { typeId: otherType, eventId: other.id });
    const v = await lookup(otherKiosk.ctx(), vol.shortCode, other.id);
    expect(v).toMatchObject({ status: 'desk', name: 'Gus Helper' });
    expect(
      await executeCommand(
        kioskPrintCommand,
        { eventId: other.id, ticketId: vol.id, pass: v.pass, requestKey: key() },
        otherKiosk.ctx(),
        ports,
      ),
    ).toEqual({ status: 'desk' });
    expect(await jobsOf(due.id)).toHaveLength(0);
  });

  it("serves a browser job's PDF to the kiosk that made it only", async () => {
    const t = await ticketFor('Hana Ito');
    const { pass } = await lookup(kiosk.ctx(), t.shortCode);
    const r = await kprint(kiosk.ctx(), { ticketId: t.id, pass });
    if (r.status !== 'printing' || !r.pdfToken) throw new Error('expected a browser job');
    const badge = await executeQuery(
      kioskJobBadgeQuery,
      { eventId: ev.id, token: r.pdfToken },
      kiosk.ctx(),
      ports,
    );
    expect(badge.title).toContain('Hana Ito');
    expect(badge.html.length).toBeGreaterThan(100);
    await expectRefused(
      executeQuery(kioskJobBadgeQuery, { eventId: ev.id, token: r.pdfToken }, kiosk2.ctx(), ports),
      'not_found',
    );
    await expectRefused(
      executeQuery(
        kioskJobBadgeQuery,
        { eventId: ev.id, token: `${r.pdfToken.slice(0, -2)}xx` },
        kiosk.ctx(),
        ports,
      ),
      'not_found',
    );
  });

  it('prints to the event’s PrintNode printer when the organizer chose one (queued, then handed over)', async () => {
    await executeCommand(setPrintNodeCommand, { enabled: true }, systemCtx(a.org.id), ports);
    const pn = await executeCommand(
      createPrinterCommand,
      { eventId: ev.id, name: `Kiosk PN ${Date.now()}`, adapter: 'printnode', printnodePrinterId: 4242 },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setKioskSettingsCommand,
      { eventId: ev.id, enabled: true, printerId: pn.id },
      a.ctx(),
      ports,
    );
    try {
      const t = await ticketFor('Ivo Petrov');
      const { pass } = await lookup(kiosk.ctx(), t.shortCode);
      const r = await kprint(kiosk.ctx(), { ticketId: t.id, pass });
      expect(r).toMatchObject({ status: 'printing', adapter: 'printnode', queued: true, pdfToken: null });
      if (r.status !== 'printing') throw new Error('expected a job');
      const printNode = fakePrintNode();
      const sent = await sendPrintJob({ ports, renderer, printNode }, kiosk.ctx(), r.jobId);
      expect(sent.status).toBe('sent');
      expect(printNode.jobs).toHaveLength(1);
    } finally {
      await executeCommand(setKioskSettingsCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    }
  });
});

describe('emailed kiosk codes', () => {
  const ask = (email: string, ctx = kiosk.ctx()) =>
    executeCommand(requestCode, { eventId: ev.id, email }, ctx, ports);
  const verify = (challengeId: string, code: string, ctx = kiosk.ctx()) =>
    executeCommand(kioskVerifyCodeCommand, { eventId: ev.id, challengeId, code }, ctx, ports);
  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

  it("identifies the holder's own ticket; the code works once; nothing personal is stored", async () => {
    const t = await ticketFor('Jo Banks');
    const r = await ask(t.email.toUpperCase());
    expect(r.send?.to).toBe(t.email);
    expect(r.send?.code).toMatch(/^\d{6}$/);
    const code = r.send?.code as string;
    const [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<Record<string, unknown>>(
        sql`select * from badges.kiosk_challenges where id = ${r.challengeId}`,
      ),
    );
    expect(JSON.stringify(row)).not.toContain(t.email);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(await verify(r.challengeId, wrong(code))).toEqual({ status: 'wrong', attemptsLeft: 4 });
    const ok = await verify(r.challengeId, `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(ok).toMatchObject({
      status: 'ok',
      checkInCode: t.shortCode,
      badge: { ticketId: t.id, name: 'Jo Banks' },
    });
    expect(await verify(r.challengeId, code)).toEqual({ status: 'expired' });
    if (ok.status !== 'ok') throw new Error('expected ok');
    expect(await kprint(kiosk.ctx(), { ticketId: t.id, pass: ok.badge.pass })).toMatchObject({
      status: 'printing',
    });
  });

  it('answers the same for an unknown address, and no code ever matches it', async () => {
    const r = await ask(`nobody${Date.now()}@kiosk.test`);
    expect(r.send).toBeNull();
    expect(Object.keys(r).sort()).toEqual(['challengeId', 'eventName', 'send']);
    for (const c of ['000000', '123456']) expect((await verify(r.challengeId, c)).status).toBe('wrong');
  });

  it('sends several tickets and a waiting registration to the desk', async () => {
    const shared = `pair${Date.now()}@kiosk.test`;
    await ticketFor('Kim One', { email: shared });
    await ticketFor('Kim Two', { email: shared });
    const two = await ask(shared);
    expect(await verify(two.challengeId, two.send?.code as string)).toEqual({ status: 'desk' });
    waitingAnswer = true;
    try {
      const w = await ask(`applicant${Date.now()}@kiosk.test`);
      expect(w.send).not.toBeNull();
      expect(await verify(w.challengeId, w.send?.code as string)).toEqual({ status: 'desk' });
    } finally {
      waitingAnswer = false;
    }
  });

  it('locks after five wrong tries; a code works only on the kiosk that asked; a newer code retires it', async () => {
    const t = await ticketFor('Lee Park');
    const r = await ask(t.email);
    const code = r.send?.code as string;
    expect(await verify(r.challengeId, code, kiosk2.ctx())).toEqual({ status: 'expired' });
    for (let i = 4; i >= 1; i--)
      expect(await verify(r.challengeId, wrong(code))).toEqual({ status: 'wrong', attemptsLeft: i });
    expect(await verify(r.challengeId, wrong(code))).toEqual({ status: 'locked' });
    expect(await verify(r.challengeId, code)).toEqual({ status: 'locked' });
    const first = await ask(t.email);
    const second = await ask(t.email);
    expect(await verify(first.challengeId, first.send?.code as string)).toEqual({ status: 'expired' });
    expect((await verify(second.challengeId, second.send?.code as string)).status).toBe('ok');
  });

  it('is refused when the organizer turned email codes off, and for invalid addresses', async () => {
    await expectRefused(ask('not-an-email'), 'validation_failed');
    await executeCommand(
      setKioskSettingsCommand,
      { eventId: ev.id, enabled: true, emailCodes: false },
      a.ctx(),
      ports,
    );
    try {
      await expectRefused(ask('someone@kiosk.test'), 'forbidden', 'email_codes_off');
    } finally {
      await executeCommand(setKioskSettingsCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    }
  });
});

describe('offline snapshot', () => {
  it("holds every badge's details and status, allowlisted; only for a kiosk at the event", async () => {
    const t = await ticketFor('Mia Snap');
    const s = await executeQuery(kioskSnapshotQuery, { eventId: ev.id }, kiosk.ctx(), ports);
    expect(s).toMatchObject({ eventId: ev.id, emailCodes: true, adapter: 'browser' });
    const mine = s.badges.find((x) => x.ticketId === t.id);
    expect(mine).toMatchObject({ name: 'Mia Snap', status: 'ready' });
    expect(s.badges.some((x) => x.status === 'printed')).toBe(true);
    for (const x of s.badges) expect(Object.keys(x).sort()).toEqual(Object.keys(KioskBadgeDto.shape).sort());
    expect(JSON.stringify(s)).not.toContain('@kiosk.test');
    await expectRefused(
      executeQuery(kioskSnapshotQuery, { eventId: ev.id }, (await device('Snoop')).ctx(), ports),
      'forbidden',
      'not_kiosk',
    );
  });
});

describe('waiting registrations (the registration side of the email lookup)', () => {
  it("knows the fixture's pending applicant, case-insensitively; not other addresses or orgs", async () => {
    const at = (f: OrgFixture, email: string) =>
      withTenant(f.ctx(), (tx) => hasWaitingRegistrationTx(tx, a.event.id, email));
    expect(await at(a, `applicant@${a.org.slug}.test`)).toBe(true);
    expect(await at(a, `Applicant@${a.org.slug}.TEST`)).toBe(true);
    expect(await at(a, `member@${a.org.slug}.test`)).toBe(false);
    expect(await at(b, `applicant@${a.org.slug}.test`)).toBe(false);
  });
});
