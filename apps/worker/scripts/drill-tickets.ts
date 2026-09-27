// Check-in drill tickets (M1.9 acceptance; runbook docs/runbooks/checkin-drill.md).
// Development or staging only, with the fake payment provider — never production.
//
//   pnpm --filter @yayatoh/worker drill-tickets -- --org lakeside-events --out ./drill
//   pnpm --filter @yayatoh/worker drill-tickets -- --org lakeside-events --starts 2026-10-01T17:00:00Z
//
// Creates a published event "Check-in drill …" with two entrances and a zone, 265 valid tickets and
// 5 tickets whose payment was refunded (the drill's "unpaid": they scan as cancelled), and writes:
//   <out>/scan-plan.csv   300 scans: which device scans which code, in which order, and the
//                         expected result (265 admits, 20 cross-device duplicates, 10 invalid, 5 unpaid)
//   <out>/cards.html      one printable QR card per planned scan (print it, or show it on a screen)
//   <out>/results.md      the results template, pre-filled with the event and the expected counts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { billingEntitlements } from '@yayatoh/billing';
import { createCheckpointCommand } from '@yayatoh/checkin';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  orderByManageToken,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { escapeHtml, qrPath } from '@yayatoh/pdf';
import { createCommandPorts, localKeyVault, setKeyVault } from '@yayatoh/platform';
import { orgAuthorizer, resolveOrgSlug } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';

export const DRILL = {
  valid: 265,
  duplicates: 20,
  invalid: 10,
  unpaid: 5,
  devices: ['A', 'B', 'C'],
} as const;

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    org: { type: 'string' },
    out: { type: 'string', default: './drill' },
    starts: { type: 'string' },
    timezone: { type: 'string', default: 'America/Chicago' },
  },
});
if (!values.org) throw new Error('--org <slug> is required');
if (process.env.NODE_ENV === 'production' || (process.env.PAYMENTS_PROVIDER ?? 'fake') !== 'fake')
  throw new Error('drill-tickets runs only against development or staging with the fake payment provider');

// Ticket signing keys are sealed by the KMS; until AWS KMS arrives, dev/staging use the local vault.
if (process.env.LOCAL_KMS_KEY) setKeyVault(localKeyVault(process.env.LOCAL_KMS_KEY));
const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });
const org = await resolveOrgSlug(values.org);
if (!org) throw new Error(`no org ${values.org}`);
const orgId = org.orgId;
const staff = () => createCtx({ orgId, actor: { type: 'system', name: 'drill:cli' } });
const guest = () => createCtx({ orgId });

const starts = values.starts ? new Date(values.starts) : new Date();
if (Number.isNaN(starts.getTime())) throw new Error('--starts must be an ISO date-time');
const ends = new Date(starts.getTime() + 6 * 3_600_000);
const name = `Check-in drill ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
const event = await executeCommand(
  createEventCommand,
  { name, timezone: values.timezone, startsAt: starts.toISOString(), endsAt: ends.toISOString() },
  staff(),
  ports,
);
const free = await executeCommand(
  createTicketTypeCommand,
  { eventId: event.id, name: 'Drill pass', priceMinor: 0, quantityTotal: DRILL.valid, maxPerOrder: 50 },
  staff(),
  ports,
);
const paid = await executeCommand(
  createTicketTypeCommand,
  {
    eventId: event.id,
    name: 'Drill refunded pass',
    priceMinor: 100,
    quantityTotal: DRILL.unpaid,
    maxPerOrder: 1,
  },
  staff(),
  ports,
);
await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, staff(), ports);
for (const [cp, kind] of [
  ['North gate', 'entrance'],
  ['South gate', 'entrance'],
  ['VIP lounge', 'zone'],
] as const)
  await executeCommand(createCheckpointCommand, { eventId: event.id, name: cp, kind }, staff(), ports);

type Ticket = { shortCode: string; code: string; holder: string };
const valid: Ticket[] = [];
for (let n = 0; valid.length < DRILL.valid; n++) {
  const quantity = Math.min(50, DRILL.valid - valid.length);
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: event.id,
      items: [{ ticketTypeId: free.id, quantity }],
      buyer: { email: `drill+${n}@example.test`, name: `Drill Guest ${n + 1}` },
    },
    guest(),
    ports,
  );
  for (const t of (await orderByManageToken(r.manageToken))?.tickets ?? [])
    valid.push({ shortCode: t.shortCode, code: t.code, holder: `Drill Guest ${n + 1}` });
}

// "Unpaid": paid with the fake provider, then refunded in full, so the tickets are void.
const unpaid: Ticket[] = [];
for (let n = 0; n < DRILL.unpaid; n++) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: event.id,
      items: [{ ticketTypeId: paid.id, quantity: 1 }],
      buyer: { email: `drill-unpaid+${n}@example.test`, name: `Drill Unpaid ${n + 1}` },
    },
    guest(),
    ports,
  );
  const pi = `fakepi_drill_${event.id}_${n}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.order.id, provider: 'fake', providerPaymentId: pi },
    guest(),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_drill_${event.id}_${n}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: r.order.totalMinor,
      currency: r.order.currency,
      orgId,
      orderId: r.order.id,
    },
    staff(),
    ports,
  );
  const tickets = (await orderByManageToken(r.manageToken))?.tickets ?? [];
  const refund = await executeCommand(
    startRefundCommand,
    { orderId: r.order.id, reason: 'requested_by_customer', ticketIds: tickets.map((t) => t.id) },
    staff(),
    ports,
  );
  await executeCommand(
    completeRefundCommand,
    { refundId: refund.refundId, outcome: 'succeeded', providerRefundId: `fakere_drill_${event.id}_${n}` },
    staff(),
    ports,
  );
  for (const t of tickets)
    unpaid.push({ shortCode: t.shortCode, code: t.code, holder: `Drill Unpaid ${n + 1}` });
}

// The plan: every valid ticket once (round-robin over the devices), 20 of them again on the next
// device (cross-device duplicates, scanned while both devices are offline), 10 invalid codes
// (5 tampered signatures, 5 unknown short codes) and the 5 refunded tickets.
type Scan = {
  device: string;
  kind: 'valid' | 'duplicate' | 'invalid' | 'unpaid';
  code: string;
  expect: string;
  holder: string;
};
const devices = DRILL.devices;
const plan: Scan[] = valid.map((t, i) => ({
  device: devices[i % devices.length] as string,
  kind: 'valid',
  code: t.code,
  expect: 'admitted',
  holder: t.holder,
}));
for (let i = 0; i < DRILL.duplicates; i++) {
  const first = plan[i * 13] as Scan;
  plan.push({
    device: devices[(devices.indexOf(first.device as 'A') + 1) % devices.length] as string,
    kind: 'duplicate',
    code: first.code,
    expect: 'duplicate_offline (one of the pair)',
    holder: first.holder,
  });
}
for (let i = 0; i < DRILL.invalid; i++) {
  const base = valid[i] as Ticket;
  const code =
    i < 5 ? `${base.code.slice(0, -2)}${base.code.endsWith('AA') ? 'BB' : 'AA'}` : `ZZZZZZZ${'23456'[i - 5]}`;
  plan.push({
    device: devices[i % devices.length] as string,
    kind: 'invalid',
    code,
    expect: 'invalid',
    holder: '',
  });
}
for (const [i, t] of unpaid.entries())
  plan.push({
    device: devices[i % devices.length] as string,
    kind: 'unpaid',
    code: t.code,
    expect: 'void',
    holder: t.holder,
  });
// Interleave deterministically so each device sees a mix, then number the scans.
plan.sort((a, b) => (a.device === b.device ? 0 : a.device < b.device ? -1 : 1));

const out = resolve(values.out ?? './drill');
mkdirSync(out, { recursive: true });
const csv = [
  'seq,device,kind,expected,holder,code',
  ...plan.map((s, i) =>
    [i + 1, s.device, s.kind, s.expect, s.holder, s.code]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  ),
].join('\n');
writeFileSync(join(out, 'scan-plan.csv'), `${csv}\n`);

const card = (s: Scan, i: number) => {
  const q = qrPath(s.code);
  return `<figure class="card"><svg viewBox="0 0 ${q.size} ${q.size}" role="img" aria-label="QR ${i + 1}"><path d="${q.d}"/></svg><figcaption>#${i + 1} · device ${s.device} · ${escapeHtml(s.kind)}</figcaption></figure>`;
};
writeFileSync(
  join(out, 'cards.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(name)} — scan cards</title>
<style>body{font-family:system-ui,sans-serif;margin:12mm}h1{font-size:14pt}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6mm}
.card{margin:0;break-inside:avoid;text-align:center}svg{width:40mm;height:40mm}figcaption{font-size:9pt}</style>
<h1>${escapeHtml(name)} — ${plan.length} scans (device order: ${devices.join(', ')})</h1><div class="grid">${plan.map(card).join('')}</div></html>\n`,
);

writeFileSync(
  join(out, 'results.md'),
  `# Check-in drill results — ${name}

Event id: \`${event.id}\` · org: \`${values.org}\` · generated ${new Date().toISOString()}

Fill in during and after the drill (runbook: docs/runbooks/checkin-drill.md).

| Planned | Count |
|---|---|
| Valid first scans | ${DRILL.valid} |
| Cross-device duplicates | ${DRILL.duplicates} |
| Invalid codes | ${DRILL.invalid} |
| Unpaid (refunded, void) | ${DRILL.unpaid} |
| **Total scans** | **${plan.length}** |

## Devices
| Device | Model / OS / browser | Battery start → end | Clock offset (door screen) | Scans made |
|---|---|---|---|---|
| A | | | | |
| B | | | | |
| C | | | | |

## Pass criteria (roadmap M1.9)
| Criterion | Target | Measured | Pass? |
|---|---|---|---|
| Scans on the server (\`checkin.scans\` for this event) | ${plan.length} (zero lost) | | |
| Same-device double admissions | 0 | | |
| Cross-device duplicates flagged \`duplicate_offline\` | ${DRILL.duplicates} | | |
| Time from reconnect to the last duplicate alert on the door screen | ≤ 60 s | | |
| Live admissions | ${DRILL.valid} | | |
| Invalid results | ${DRILL.invalid} | | |
| Cancelled (void) results | ${DRILL.unpaid} | | |
| p95 online verdict latency at 20 scans/s | < 300 ms | | |
| Emails or full phone numbers in the manifest | none | | |

## Notes and incidents
-
`,
);

process.stdout.write(
  `drill: event "${name}" (${event.id}) with ${valid.length} valid + ${unpaid.length} refunded tickets; ${plan.length} scans planned → ${out}\n`,
);
// One-shot CLI: exit rather than wait for idle pool connections to time out.
process.exit(0);
