import { admissionsForTicketsTx, scanLogForTicketsTx } from '@yayatoh/checkin';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { orderMessagesQuery } from '@yayatoh/notifications';
import { orderDetailQuery, orderRefundsQuery } from '@yayatoh/orders';
import { disputeTx, EVIDENCE_OPTIONAL_SECTIONS } from '@yayatoh/payments';
import { tenantQuery } from '@yayatoh/platform';
import { legalPageTx, organizationNameTx } from '@yayatoh/tenancy';
import { z } from 'zod';

/** Bounded so the packet stays under the card networks' limits (4.5 MB / 19 pages). */
const MAX_TICKETS = 60;

export const DisputeEvidenceDto = z.object({
  dispute: z.object({
    id: z.uuid(),
    reason: z.string(),
    amountMinor: z.int(),
    currency: z.string(),
    status: z.string(),
    openedAt: z.date(),
    evidenceDueBy: z.date().nullable(),
  }),
  seller: z.object({ name: z.string(), fundsFlow: z.enum(['organizer_mor', 'platform_mor']) }),
  event: z.object({
    name: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    timezone: z.string(),
    venue: z.string().nullable(),
    city: z.string().nullable(),
  }),
  order: z.object({
    id: z.uuid(),
    createdAt: z.date(),
    paidAt: z.date().nullable(),
    buyerName: z.string(),
    buyerEmail: z.string(),
    totalMinor: z.int(),
    feeMinor: z.int(),
    status: z.string(),
    items: z.array(z.object({ name: z.string(), quantity: z.int(), unitAllInMinor: z.int() })),
  }),
  tickets: z.array(
    z.object({
      serial: z.int(),
      shortCode: z.string(),
      holderName: z.string(),
      status: z.string(),
      admittedAt: z.array(z.date()),
    }),
  ),
  ticketsOmitted: z.int(),
  refunds: z.array(
    z.object({ amountMinor: z.int(), status: z.string(), createdAt: z.date(), reason: z.string() }),
  ),
  refundPolicy: z.object({ body: z.string(), updatedAt: z.date() }).nullable(),
  /** M1.6e: every door scan of these tickets (the access log), rejections included. */
  scans: z.array(
    z.object({
      serial: z.int(),
      at: z.date(),
      result: z.string(),
      checkpoint: z.string().nullable(),
      offline: z.boolean(),
    }),
  ),
  /** M1.6e: what the buyer was sent about the order (no bodies: kind, subject, status). */
  messages: z.array(
    z.object({
      at: z.date(),
      kind: z.string(),
      channel: z.string(),
      status: z.string(),
      subject: z.string().nullable(),
    }),
  ),
  /** M1.6e: the reviewer's statement and the sections they left out. */
  review: z.object({ summary: z.string().nullable(), excluded: z.array(z.enum(EVIDENCE_OPTIONAL_SECTIONS)) }),
});
export type DisputeEvidenceDto = z.infer<typeof DisputeEvidenceDto>;

/**
 * The evidence packet for a dispute (roadmap §5.3): what was bought, when, by whom, the event,
 * every admission scan of its tickets, refunds, and the organizer's refund policy. A human always
 * reviews it before it is submitted. Built only from this org's data (RLS).
 */
export const disputeEvidenceQuery = tenantQuery({
  name: 'reports.disputeEvidence',
  input: z.object({ disputeId: z.uuid() }),
  output: DisputeEvidenceDto,
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const d = await disputeTx(tx, input.disputeId);
    if (!d) throw new DomainError('not_found', 'Dispute not found');
    const order = await orderDetailQuery.handler({ input: { orderId: d.orderId }, ctx, tx });
    const event = await findEventTx(tx, d.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const tickets = order.tickets.slice(0, MAX_TICKETS);
    const scans = await admissionsForTicketsTx(
      tx,
      tickets.map((t) => t.id),
    );
    const refunds = await orderRefundsQuery.handler({ input: { orderId: d.orderId }, ctx, tx });
    const serialOf = new Map(tickets.map((t) => [t.id, t.serial]));
    const log = await scanLogForTicketsTx(
      tx,
      tickets.map((t) => t.id),
    );
    const sent = await orderMessagesQuery.handler({ input: { orderId: d.orderId }, ctx, tx });
    return {
      dispute: {
        id: d.id,
        reason: d.reason,
        amountMinor: d.amountMinor,
        currency: d.currency,
        status: d.status,
        openedAt: d.createdAt,
        evidenceDueBy: d.evidenceDueBy,
      },
      seller: { name: (await organizationNameTx(tx, requireOrg(ctx))) ?? '', fundsFlow: d.fundsFlow },
      event: {
        name: event.name,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        venue: event.venueName ?? null,
        city: event.city ?? null,
      },
      order: {
        id: order.id,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        totalMinor: order.totalMinor,
        feeMinor: order.feeMinor,
        status: order.status,
        items: order.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitAllInMinor: i.unitAllInMinor,
        })),
      },
      tickets: tickets.map((t) => ({
        serial: t.serial,
        shortCode: t.shortCode,
        holderName: t.holderName,
        status: t.status,
        admittedAt: scans.filter((s) => s.ticketId === t.id).map((s) => s.admittedAt),
      })),
      ticketsOmitted: order.tickets.length - tickets.length,
      refunds: refunds.map((r) => ({
        amountMinor: r.amountMinor,
        status: r.status,
        createdAt: r.createdAt,
        reason: r.reason,
      })),
      refundPolicy: await legalPageTx(tx, 'refund'),
      scans: log.map((l) => ({
        serial: serialOf.get(l.ticketId ?? '') ?? 0,
        at: l.scannedAt,
        result: l.result,
        checkpoint: l.checkpoint,
        offline: l.offline,
      })),
      messages: sent.map((m) => ({
        at: m.at,
        kind: m.kind,
        channel: m.channel,
        status: m.status,
        subject: m.subject,
      })),
      review: {
        summary: d.evidenceSummary,
        excluded: d.evidenceExcluded.filter((x): x is (typeof EVIDENCE_OPTIONAL_SECTIONS)[number] =>
          (EVIDENCE_OPTIONAL_SECTIONS as readonly string[]).includes(x),
        ),
      },
    };
  },
});

/**
 * The same packet taken out as a file (the PDF download and the submission to the provider):
 * an export, so staff acting as a member can't take it (M1.2e). Viewing it on the dispute page
 * uses `disputeEvidenceQuery`.
 */
export const disputeEvidencePacketQuery = tenantQuery({
  name: 'reports.disputeEvidencePacket',
  category: 'export',
  input: z.object({ disputeId: z.uuid() }),
  output: DisputeEvidenceDto,
  entitlement: null,
  permission: 'finance:read',
  handler: disputeEvidenceQuery.handler,
});

export const EVIDENCE_LABELS = [
  'title',
  'subtitle',
  'footer',
  'dispute',
  'reason',
  'amount',
  'opened',
  'dueBy',
  'seller',
  'sellerName',
  'soldBy',
  'soldByOrganizer',
  'soldByPlatform',
  'event',
  'eventName',
  'starts',
  'ends',
  'venue',
  'order',
  'orderId',
  'placed',
  'paid',
  'buyer',
  'total',
  'fees',
  'status',
  'items',
  'qty',
  'price',
  'tickets',
  'serial',
  'code',
  'holder',
  'admitted',
  'notAdmitted',
  'omitted',
  'refunds',
  'noRefunds',
  'refundPolicy',
  'noPolicy',
  'policyUpdated',
  'statement',
  'accessLog',
  'noScans',
  'time',
  'entrance',
  'result',
  'offline',
  'messages',
  'noMessages',
  'message',
  'channel',
  'trimmed',
] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

/**
 * Turn the evidence into the packet's sections. Labels come from the caller's i18n; dates are in
 * the event's timezone. `label('omitted', { n })` and `label('title', { id })` take values.
 */
type Row = readonly [string, string];
/** Mirrors `@yayatoh/pdf`'s EvidencePdfInput (kept structural so reports needn't depend on pdf). */
export interface EvidenceDocument {
  readonly lang: string;
  readonly title: string;
  readonly subtitle: string;
  readonly footer: string;
  readonly sections: readonly {
    /** Which packet section this is (reviewers leave optional ones out). */
    readonly id?: string;
    readonly title: string;
    readonly rows?: readonly Row[];
    readonly table?: { readonly head: readonly string[]; readonly body: readonly (readonly string[])[] };
    readonly text?: string;
    readonly note?: string;
  }[];
}

export function evidenceDocument(
  e: DisputeEvidenceDto,
  opts: {
    locale: string;
    label: (key: EvidenceLabel, values?: Record<string, string | number>) => string;
    money: (minor: number, currency: string) => string;
  },
): EvidenceDocument {
  const { label: l, money } = opts;
  const at = new Intl.DateTimeFormat(opts.locale, {
    dateStyle: 'medium',
    // 'long' includes the time zone, so every time in the packet is unambiguous.
    timeStyle: 'long',
    timeZone: e.event.timezone,
  });
  const cur = e.dispute.currency;
  return {
    lang: opts.locale,
    title: l('title', { id: e.dispute.id.slice(-8) }),
    subtitle: l('subtitle', { seller: e.seller.name }),
    footer: l('footer'),
    sections: (
      [
        ...(e.review.summary ? [{ id: 'statement', title: l('statement'), text: e.review.summary }] : []),
        {
          id: 'dispute',
          title: l('dispute'),
          rows: [
            [l('reason'), e.dispute.reason],
            [l('amount'), money(e.dispute.amountMinor, cur)],
            [l('opened'), at.format(e.dispute.openedAt)],
            ...(e.dispute.evidenceDueBy ? [[l('dueBy'), at.format(e.dispute.evidenceDueBy)] as Row] : []),
          ],
        },
        {
          id: 'seller',
          title: l('seller'),
          rows: [
            [l('sellerName'), e.seller.name],
            [
              l('soldBy'),
              e.seller.fundsFlow === 'organizer_mor' ? l('soldByOrganizer') : l('soldByPlatform'),
            ],
          ],
        },
        {
          id: 'event',
          title: l('event'),
          rows: [
            [l('eventName'), e.event.name],
            [l('starts'), at.format(e.event.startsAt)],
            [l('ends'), at.format(e.event.endsAt)],
            ...(e.event.venue || e.event.city
              ? [[l('venue'), [e.event.venue, e.event.city].filter(Boolean).join(', ')] as Row]
              : []),
          ],
        },
        {
          id: 'order',
          title: l('order'),
          rows: [
            [l('orderId'), e.order.id],
            [l('placed'), at.format(e.order.createdAt)],
            ...(e.order.paidAt ? [[l('paid'), at.format(e.order.paidAt)] as Row] : []),
            [l('buyer'), `${e.order.buyerName} <${e.order.buyerEmail}>`],
            [l('total'), money(e.order.totalMinor, cur)],
            [l('fees'), money(e.order.feeMinor, cur)],
            [l('status'), e.order.status],
          ],
          table: {
            head: [l('items'), l('qty'), l('price')],
            body: e.order.items.map((i) => [i.name, String(i.quantity), money(i.unitAllInMinor, cur)]),
          },
        },
        {
          id: 'tickets',
          title: l('tickets'),
          table: {
            head: [l('serial'), l('code'), l('holder'), l('status'), l('admitted')],
            body: e.tickets.map((t) => [
              `#${t.serial}`,
              t.shortCode,
              t.holderName,
              t.status,
              t.admittedAt.length ? t.admittedAt.map((d) => at.format(d)).join('; ') : l('notAdmitted'),
            ]),
          },
          ...(e.ticketsOmitted > 0 ? { note: l('omitted', { n: e.ticketsOmitted }) } : {}),
        },
        e.scans.length
          ? {
              id: 'accessLog',
              title: l('accessLog'),
              table: {
                head: [l('time'), l('serial'), l('entrance'), l('result')],
                body: e.scans.map((x) => [
                  at.format(x.at),
                  `#${x.serial}`,
                  x.checkpoint ?? '—',
                  x.offline ? `${x.result} (${l('offline')})` : x.result,
                ]),
              },
            }
          : { id: 'accessLog', title: l('accessLog'), text: l('noScans') },
        e.refunds.length
          ? {
              id: 'refunds',
              title: l('refunds'),
              table: {
                head: [l('opened'), l('amount'), l('status'), l('reason')],
                body: e.refunds.map((r) => [
                  at.format(r.createdAt),
                  money(r.amountMinor, cur),
                  r.status,
                  r.reason,
                ]),
              },
            }
          : { id: 'refunds', title: l('refunds'), text: l('noRefunds') },
        e.messages.length
          ? {
              id: 'messages',
              title: l('messages'),
              table: {
                head: [l('time'), l('message'), l('channel'), l('status')],
                body: e.messages.map((m) => [at.format(m.at), m.subject ?? m.kind, m.channel, m.status]),
              },
            }
          : { id: 'messages', title: l('messages'), text: l('noMessages') },
        e.refundPolicy
          ? {
              id: 'refundPolicy',
              title: l('refundPolicy'),
              text: e.refundPolicy.body,
              note: l('policyUpdated', { date: at.format(e.refundPolicy.updatedAt) }),
            }
          : { id: 'refundPolicy', title: l('refundPolicy'), text: l('noPolicy') },
      ] satisfies EvidenceDocument['sections'][number][]
    ).filter((sec) => !(e.review.excluded as readonly string[]).includes(sec.id ?? '')),
  };
}

/** The card networks' limits for an evidence packet (roadmap §5.3). */
export const PACKET_LIMITS = { maxBytes: 4_500_000, maxPages: 19 } as const;
/** A4 at the packet's type size: about this many table rows or wrapped text lines per page. */
const LINES_PER_PAGE = 40;
const CHARS_PER_LINE = 95;

const linesOf = (text: string) =>
  text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);

/** An estimate of how many A4 pages a packet document fills (headers, rows and wrapped text). */
export function estimatePages(doc: EvidenceDocument): number {
  let lines = 4; // title, subtitle, footer
  for (const s of doc.sections) {
    lines += 2 + (s.rows?.length ?? 0) + (s.note ? linesOf(s.note) : 0) + (s.text ? linesOf(s.text) : 0);
    if (s.table) lines += 1 + s.table.body.reduce((n, r) => n + Math.max(1, ...r.map(linesOf)), 0);
  }
  return Math.ceil(lines / LINES_PER_PAGE);
}

/**
 * Fit a packet into the page limit (M1.6e): the longest tables are cut first — the access log,
 * then messages, then tickets — keeping their first rows and saying how many were left out; long
 * texts are cut last. The reviewer sees exactly what will be sent.
 */
export function fitEvidenceDocument(
  doc: EvidenceDocument,
  trimmedNote: (n: number) => string,
  maxPages: number = PACKET_LIMITS.maxPages,
): EvidenceDocument {
  let sections = doc.sections.map((s) => ({ ...s }));
  const current = () => estimatePages({ ...doc, sections });
  for (const id of ['accessLog', 'messages', 'tickets']) {
    const i = sections.findIndex((s) => s.id === id && s.table);
    const sec = sections[i];
    if (!sec?.table || current() <= maxPages) continue;
    const all = sec.table.body;
    let keep = all.length;
    while (keep > 5 && current() > maxPages) {
      keep = Math.max(5, Math.floor(keep * 0.8));
      sections[i] = {
        ...sec,
        table: { head: sec.table.head, body: all.slice(0, keep) },
        note: [sec.note, trimmedNote(all.length - keep)].filter(Boolean).join(' '),
      };
    }
  }
  if (current() > maxPages)
    sections = sections.map((s) =>
      s.text && s.text.length > 6_000
        ? { ...s, text: `${s.text.slice(0, 6_000)}…`, note: trimmedNote(1) }
        : s,
    );
  return { ...doc, sections };
}

/** Pages and size of a rendered PDF, checked against the networks' limits before submission. */
export function packetWithinLimits(pdf: Uint8Array): { ok: boolean; bytes: number; pages: number } {
  const text = new TextDecoder('latin1').decode(pdf);
  const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  return {
    ok: pdf.byteLength <= PACKET_LIMITS.maxBytes && pages >= 1 && pages <= PACKET_LIMITS.maxPages,
    bytes: pdf.byteLength,
    pages,
  };
}
