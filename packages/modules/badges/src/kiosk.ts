import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { requireKioskDeviceTx } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import {
  appTokenSecret,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import {
  activeTicketIdForCodeTx,
  activeTicketShortCodeTx,
  activeTicketsHeldByTx,
  type BadgeTicket,
  badgeTicketsTx,
} from '@yayatoh/ticketing';
import { and, count, eq, gt, inArray, isNull, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { badgeDetailsTx } from './batches.ts';
import {
  formatKioskCode,
  isKioskCodeShape,
  judgeKioskCode,
  KIOSK_CODE_ATTEMPTS,
  KIOSK_CODE_TTL_MS,
  KIOSK_PASS_TTL_MS,
  kioskBadgeStatus,
  kioskEmailOutcome,
  normalizeKioskCode,
} from './domain/kiosk.ts';
import { PRINT_PDF_TTL_MS } from './domain/printing.ts';
import { jobBadgeTx, lockBadgePrintTx, printerOfTx, printNodeEnabledTx, priorPrintsTx } from './printing.ts';
import { kioskChallenges, kioskSettings, printers, printJobs } from './schema.ts';
import { eventOfTx } from './templates.ts';

/**
 * M5.5c kiosk self-print. A kiosk (a Scan PWA device in kiosk mode, M3.4a) identifies one attendee
 * by possession — their ticket's code, or a one-time code emailed to the ticket's holder — shows
 * only that attendee's badge details, and prints the badge once. Every device command checks that
 * the caller is a live kiosk locked to the event (`requireKioskDeviceTx`) and that the organizer
 * turned self-print on. Reprints, balances due and waiting registrations go to the desk.
 */

/* ------------------------------------------------------------------------- settings ---- */

export const KioskSettingsDto = z.object({
  eventId: z.uuid(),
  enabled: z.boolean(),
  /** Null: the kiosk's own print dialog. */
  printerId: z.uuid().nullable(),
  emailCodes: z.boolean(),
});
export type KioskSettingsDto = z.infer<typeof KioskSettingsDto>;

async function settingsTx(tx: TenantTx, eventId: string): Promise<KioskSettingsDto> {
  const [s] = await tx.select().from(kioskSettings).where(eq(kioskSettings.eventId, eventId));
  return s
    ? { eventId, enabled: s.enabled, printerId: s.printerId, emailCodes: s.emailCodes }
    : { eventId, enabled: false, printerId: null, emailCodes: true };
}

/** The event's kiosk self-print settings (off by default). */
export const kioskSettingsQuery = tenantQuery({
  name: 'badges.kioskSettings',
  input: z.object({ eventId: z.uuid() }),
  output: KioskSettingsDto,
  entitlement: 'badges',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    return settingsTx(tx, input.eventId);
  },
});

/** Turn kiosk self-print on or off, and choose where kiosks print and whether email codes work. */
export const setKioskSettingsCommand = tenantCommand({
  name: 'badges.setKioskSettings',
  input: z.object({
    eventId: z.uuid(),
    enabled: z.boolean(),
    printerId: z.uuid().nullable().default(null),
    emailCodes: z.boolean().default(true),
  }),
  output: KioskSettingsDto,
  entitlement: 'badges',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOfTx(tx, input.eventId);
    if (input.printerId) {
      const p = await printerOfTx(tx, input.eventId, input.printerId);
      if (p.archivedAt)
        throw new DomainError('invalid_state', 'Printer archived', {
          reason: 'archived',
          field: 'printerId',
        });
      if (p.adapter === 'printnode' && !(await printNodeEnabledTx(tx)))
        throw new DomainError('invalid_state', 'PrintNode is off', {
          reason: 'printnode_off',
          field: 'printerId',
        });
    }
    const values = {
      enabled: input.enabled,
      printerId: input.printerId,
      emailCodes: input.emailCodes,
      updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      updatedAt: ctx.now,
    };
    await tx
      .insert(kioskSettings)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, ...values })
      .onConflictDoUpdate({ target: [kioskSettings.orgId, kioskSettings.eventId], set: values });
    return settingsTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'badges.kiosk_settings',
    targetType: 'event',
    targetId: input.eventId,
    data: { enabled: input.enabled, printerId: input.printerId, emailCodes: input.emailCodes },
  }),
});

/* ------------------------------------------------------------------- the kiosk itself ---- */

/** The device is a kiosk at this event and the organizer turned self-print on. */
async function kioskTx(tx: TenantTx, ctx: Ctx, eventId: string) {
  const device = await requireKioskDeviceTx(tx, ctx, eventId);
  const settings = await settingsTx(tx, eventId);
  if (!settings.enabled)
    throw new DomainError('forbidden', 'Kiosk self-print is off', { reason: 'kiosk_print_off' });
  return { device, settings };
}

/**
 * One attendee's badge as a kiosk may show it: what the badge will say and what the kiosk can do.
 * Never an email, a code, an order or anyone else's details.
 */
export const KioskBadgeDto = z.object({
  ticketId: z.uuid(),
  /** The holder's name as the badge prints it (the full name when the template places none). */
  name: z.string(),
  company: z.string(),
  jobTitle: z.string(),
  typeName: z.string(),
  status: z.enum(['ready', 'printed', 'desk']),
});
export type KioskBadgeDto = z.infer<typeof KioskBadgeDto>;

async function printsByTicketTx(tx: TenantTx, ticketIds: readonly string[]): Promise<Map<string, number>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await tx
    .select({ ticketId: printJobs.ticketId, n: count() })
    .from(printJobs)
    .where(and(inArray(printJobs.ticketId, [...ticketIds]), ne(printJobs.status, 'failed')))
    .groupBy(printJobs.ticketId);
  return new Map(rows.map((r) => [r.ticketId, r.n]));
}

async function kioskBadgesTx(tx: TenantTx, eventId: string, tickets: readonly BadgeTicket[]) {
  const details = await badgeDetailsTx(tx, eventId, tickets);
  const prints = await printsByTicketTx(
    tx,
    tickets.map((t) => t.id),
  );
  return tickets.map((t): KioskBadgeDto => {
    const d = details.get(t.id);
    const name = d ? `${d.firstName} ${d.lastName}`.trim() : '';
    return KioskBadgeDto.parse({
      ticketId: t.id,
      name: name || t.holderName,
      company: d?.company ?? '',
      jobTitle: d?.jobTitle ?? '',
      typeName: t.typeName,
      status: kioskBadgeStatus({
        prints: prints.get(t.id) ?? 0,
        paymentDue: t.paymentDue,
        hasTemplate: d !== undefined,
      }),
    });
  });
}

async function oneKioskBadgeTx(tx: TenantTx, eventId: string, ticketId: string): Promise<KioskBadgeDto> {
  const tickets = await badgeTicketsTx(tx, { eventId, ticketIds: [ticketId] });
  const [b] = await kioskBadgesTx(tx, eventId, tickets);
  if (!b) throw new DomainError('not_found', 'Ticket not found');
  return b;
}

/* A short-lived proof that this kiosk identified this ticket (`<expiry ms>_<ticketId>~<hmac>`). */
const passPurpose = (deviceId: string, exp: number) => `badges.kiosk-pass:${deviceId}:${exp}`;
const signPass = (deviceId: string, ticketId: string, now: Date) => {
  const exp = now.getTime() + KIOSK_PASS_TTL_MS;
  return `${exp}_${signLinkToken(passPurpose(deviceId, exp), ticketId)}`;
};
function passAllows(token: string | undefined, deviceId: string, ticketId: string, now: Date): boolean {
  if (!token) return false;
  const sep = token.indexOf('_');
  const exp = Number(token.slice(0, sep));
  if (sep <= 0 || !Number.isSafeInteger(exp) || exp <= now.getTime()) return false;
  return verifyLinkToken(passPurpose(deviceId, exp), token.slice(sep + 1)) === ticketId;
}

const Identified = KioskBadgeDto.extend({ pass: z.string() });

/** The attendee scanned (or typed) their ticket's code: their badge, and the proof to print it. */
export const kioskLookupQuery = tenantQuery({
  name: 'badges.kioskLookup',
  input: z.object({ eventId: z.uuid(), code: z.string().trim().min(4).max(2000) }),
  output: Identified,
  entitlement: 'badges',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }) => {
    const { device } = await kioskTx(tx, ctx, input.eventId);
    const ticketId = await activeTicketIdForCodeTx(tx, input.eventId, input.code);
    if (!ticketId) throw new DomainError('not_found', 'Ticket not found');
    const badge = await oneKioskBadgeTx(tx, input.eventId, ticketId);
    return { ...badge, pass: signPass(device.deviceId, ticketId, ctx.now) };
  },
});

/* -------------------------------------------------------------------- emailed codes ---- */

const codeHash = (challengeId: string, code: string) =>
  createHmac('sha256', appTokenSecret())
    .update(`badges.kiosk-code:${challengeId}:${code}`)
    .digest('base64url');

/**
 * Something that knows whether an address has a registration still waiting at the event (an
 * application not yet decided, an approval not yet paid for). Registration is composed by the app
 * (it sits on the same tier as badges).
 */
export type WaitingRegistrationLookup = (tx: TenantTx, eventId: string, email: string) => Promise<boolean>;

const KioskEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * "No ticket with you? Use your email": a six-digit code for the holder's own ticket. The answer is
 * the same whether or not the address has anything at the event; `send` (the address and code to
 * email) is for the caller's mailer only and is null when there is nothing to send. Earlier codes of
 * this kiosk stop working.
 */
export const kioskRequestCodeCommand = (waiting: WaitingRegistrationLookup) =>
  tenantCommand({
    name: 'badges.kioskRequestCode',
    input: z.object({ eventId: z.uuid(), email: KioskEmail }),
    output: z.object({
      challengeId: z.uuid(),
      eventName: z.string(),
      send: z.object({ to: z.string(), code: z.string() }).nullable(),
    }),
    entitlement: 'badges',
    permission: 'checkin:device',
    handler: async ({ input, ctx, tx }) => {
      const { device, settings } = await kioskTx(tx, ctx, input.eventId);
      if (!settings.emailCodes)
        throw new DomainError('forbidden', 'Email codes are off', { reason: 'email_codes_off' });
      const ev = await eventOfTx(tx, input.eventId);
      const own = await activeTicketsHeldByTx(tx, input.eventId, input.email);
      const outcome = kioskEmailOutcome(
        own.length,
        own.length === 0 && (await waiting(tx, input.eventId, input.email)),
      );
      // Spent and expired codes are forgotten after a day; this kiosk's open codes retire.
      await tx
        .delete(kioskChallenges)
        .where(lt(kioskChallenges.expiresAt, new Date(ctx.now.getTime() - 86_400_000)));
      await tx
        .update(kioskChallenges)
        .set({ expiresAt: ctx.now, updatedAt: ctx.now })
        .where(
          and(
            eq(kioskChallenges.deviceId, device.deviceId),
            isNull(kioskChallenges.usedAt),
            gt(kioskChallenges.expiresAt, ctx.now),
          ),
        );
      const code = formatKioskCode(randomInt(0, 1_000_000));
      const id = uuidv7();
      await tx.insert(kioskChallenges).values({
        id,
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        deviceId: device.deviceId,
        outcome,
        ticketId: outcome === 'ticket' ? (own[0]?.id ?? null) : null,
        // The HMAC binds the code to its challenge.
        codeHash: codeHash(id, code),
        expiresAt: new Date(ctx.now.getTime() + KIOSK_CODE_TTL_MS),
      });
      return {
        challengeId: id,
        eventName: ev.name,
        send: outcome === 'none' ? null : { to: input.email, code },
      };
    },
    // Neither the address nor whether it matched: only that a kiosk asked.
    audit: (input, r) => ({
      action: 'badges.kiosk_code',
      targetType: 'kiosk_challenge',
      targetId: r.challengeId,
      data: { eventId: input.eventId },
    }),
  });

export const KioskVerifyDto = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    badge: Identified,
    /** The ticket's short code, so the kiosk checks the attendee in like a scan (never shown). */
    checkInCode: z.string(),
  }),
  z.object({ status: z.literal('desk') }),
  z.object({ status: z.literal('wrong'), attemptsLeft: z.int() }),
  z.object({ status: z.enum(['locked', 'expired']) }),
]);
export type KioskVerifyDto = z.infer<typeof KioskVerifyDto>;

/**
 * Check an emailed code on the kiosk that asked for it. Wrong tries count (the fifth locks it, even
 * against the right code) and are returned, never thrown, so the count commits; a right one is
 * spent. A code that led nowhere never matches.
 */
export const kioskVerifyCodeCommand = tenantCommand({
  name: 'badges.kioskVerifyCode',
  input: z.object({ eventId: z.uuid(), challengeId: z.uuid(), code: z.string().max(20) }),
  output: KioskVerifyDto,
  entitlement: 'badges',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }): Promise<KioskVerifyDto> => {
    const { device } = await kioskTx(tx, ctx, input.eventId);
    const [c] = await tx
      .select()
      .from(kioskChallenges)
      .where(
        and(
          eq(kioskChallenges.id, input.challengeId),
          eq(kioskChallenges.eventId, input.eventId),
          eq(kioskChallenges.deviceId, device.deviceId),
        ),
      )
      .for('update');
    if (!c) return { status: 'expired' };
    const code = normalizeKioskCode(input.code);
    const given = Buffer.from(isKioskCodeShape(code) ? codeHash(c.id, code) : '');
    const stored = Buffer.from(c.codeHash);
    const matches = c.outcome !== 'none' && given.length === stored.length && timingSafeEqual(given, stored);
    const verdict = judgeKioskCode(c, matches, ctx.now);
    if (verdict.status === 'wrong' || (verdict.status === 'locked' && c.attempts < KIOSK_CODE_ATTEMPTS)) {
      await tx
        .update(kioskChallenges)
        .set({ attempts: c.attempts + 1, updatedAt: ctx.now })
        .where(eq(kioskChallenges.id, c.id));
    }
    if (verdict.status !== 'ok') return verdict;
    await tx
      .update(kioskChallenges)
      .set({ usedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(kioskChallenges.id, c.id));
    if (c.outcome !== 'ticket' || !c.ticketId) return { status: 'desk' };
    const tickets = await badgeTicketsTx(tx, { eventId: input.eventId, ticketIds: [c.ticketId] });
    const [badge] = await kioskBadgesTx(tx, input.eventId, tickets);
    const own = await activeTicketShortCodeTx(tx, input.eventId, c.ticketId);
    if (!badge || !own) return { status: 'desk' };
    return {
      status: 'ok',
      badge: { ...badge, pass: signPass(device.deviceId, badge.ticketId, ctx.now) },
      checkInCode: own,
    };
  },
  audit: (input, r) => ({
    action: 'badges.kiosk_code_check',
    targetType: 'kiosk_challenge',
    targetId: input.challengeId,
    data: { eventId: input.eventId, status: r.status },
  }),
});

/* ---------------------------------------------------------------------------- print ---- */

/* The kiosk's badge PDF link for a browser job it just made (`<expiry ms>_<jobId>~<hmac>`). */
const pdfPurpose = (deviceId: string, exp: number) => `badges.kiosk-pdf:${deviceId}:${exp}`;

export const KioskPrintDto = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('printing'),
    jobId: z.uuid(),
    adapter: z.enum(['browser', 'printnode']),
    /** Browser jobs: the token for this kiosk's PDF of the job. */
    pdfToken: z.string().nullable(),
    queued: z.boolean(),
  }),
  z.object({ status: z.enum(['printed', 'desk']) }),
]);
export type KioskPrintDto = z.infer<typeof KioskPrintDto>;

/**
 * Print the identified attendee's badge, once. Proof is the pass from identifying, or the ticket's
 * own code (an offline kiosk queues the print with the code it scanned). Idempotent per
 * `requestKey`; a badge that already printed (any job that did not fail) is refused as `printed`
 * under the same lock the desk takes, so two kiosks or a double tap log one print.
 */
export const kioskPrintCommand = tenantCommand({
  name: 'badges.kioskPrint',
  input: z.object({
    eventId: z.uuid(),
    ticketId: z.uuid(),
    pass: z.string().max(300).optional(),
    code: z.string().trim().max(2000).optional(),
    requestKey: z.string().trim().min(8).max(80),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .default('en'),
  }),
  output: KioskPrintDto,
  entitlement: 'badges',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }): Promise<KioskPrintDto> => {
    const { device, settings } = await kioskTx(tx, ctx, input.eventId);
    const proven =
      passAllows(input.pass, device.deviceId, input.ticketId, ctx.now) ||
      (input.code !== undefined &&
        input.code.length >= 4 &&
        (await activeTicketIdForCodeTx(tx, input.eventId, input.code)) === input.ticketId);
    if (!proven) throw new DomainError('forbidden', 'Identify first', { reason: 'not_identified' });
    const printing = (j: typeof printJobs.$inferSelect): KioskPrintDto => ({
      status: 'printing',
      jobId: j.id,
      adapter: j.adapter as 'browser' | 'printnode',
      pdfToken: j.adapter === 'browser' ? signPdf(device.deviceId, j.id, j.createdAt) : null,
      queued: j.status === 'queued',
    });
    const [prior] = await tx.select().from(printJobs).where(eq(printJobs.requestKey, input.requestKey));
    if (prior) {
      if (prior.ticketId !== input.ticketId || prior.source !== 'kiosk')
        throw new DomainError('conflict', 'Request key already used');
      return printing(prior);
    }
    await lockBadgePrintTx(tx, input.ticketId);
    const badge = await oneKioskBadgeTx(tx, input.eventId, input.ticketId);
    if (badge.status !== 'ready') return { status: badge.status };
    if ((await priorPrintsTx(tx, input.ticketId)) > 0) return { status: 'printed' };
    let printer: typeof printers.$inferSelect | null = null;
    if (settings.printerId) {
      printer = await printerOfTx(tx, input.eventId, settings.printerId);
      if (printer.archivedAt || (printer.adapter === 'printnode' && !(await printNodeEnabledTx(tx))))
        return { status: 'desk' };
    }
    const adapter = printer?.adapter === 'printnode' ? 'printnode' : 'browser';
    const [row] = await tx
      .insert(printJobs)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        ticketId: input.ticketId,
        printerId: printer?.id ?? null,
        adapter,
        kind: 'print',
        reason: 'first_print',
        status: adapter === 'browser' ? 'sent' : 'queued',
        sentAt: adapter === 'browser' ? ctx.now : null,
        source: 'kiosk',
        locale: input.locale,
        requestKey: input.requestKey,
        requestedBy: null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return printing(row);
  },
  audit: (input, r) => ({
    action: 'badges.kiosk_print',
    targetType: 'ticket',
    targetId: input.ticketId,
    data: { eventId: input.eventId, status: r.status, jobId: r.status === 'printing' ? r.jobId : null },
  }),
});

function signPdf(deviceId: string, jobId: string, createdAt: Date): string {
  const exp = createdAt.getTime() + PRINT_PDF_TTL_MS;
  return `${exp}_${signLinkToken(pdfPurpose(deviceId, exp), jobId)}`;
}

/** The badge of a browser job this kiosk made (its PDF for the kiosk's own print dialog). */
export const kioskJobBadgeQuery = tenantQuery({
  name: 'badges.kioskJobBadge',
  input: z.object({ eventId: z.uuid(), token: z.string().max(300) }),
  output: z.object({ html: z.string(), title: z.string() }),
  entitlement: 'badges',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }) => {
    const { device } = await kioskTx(tx, ctx, input.eventId);
    const sep = input.token.indexOf('_');
    const exp = Number(input.token.slice(0, sep));
    const jobId =
      sep > 0 && Number.isSafeInteger(exp) && exp > ctx.now.getTime()
        ? verifyLinkToken(pdfPurpose(device.deviceId, exp), input.token.slice(sep + 1))
        : null;
    if (!jobId) throw new DomainError('not_found', 'Print job not found');
    const [j] = await tx
      .select({ source: printJobs.source, eventId: printJobs.eventId })
      .from(printJobs)
      .where(eq(printJobs.id, jobId));
    if (j?.source !== 'kiosk' || j.eventId !== input.eventId)
      throw new DomainError('not_found', 'Print job not found');
    const b = await jobBadgeTx(tx, ctx, jobId, true);
    return { html: b.html, title: b.title };
  },
});

/* ------------------------------------------------------------------- offline snapshot ---- */

export const KioskSnapshotDto = z.object({
  eventId: z.uuid(),
  emailCodes: z.boolean(),
  adapter: z.enum(['browser', 'printnode']),
  asOf: z.date(),
  badges: z.array(KioskBadgeDto),
});
export type KioskSnapshotDto = z.infer<typeof KioskSnapshotDto>;

/**
 * What a kiosk keeps (sealed on the device) to keep working offline: every badge's details and
 * status, keyed by ticket. The kiosk only opens one after a scan resolved that ticket from its
 * manifest (possession of the code), never by search.
 */
export const kioskSnapshotQuery = tenantQuery({
  name: 'badges.kioskSnapshot',
  input: z.object({ eventId: z.uuid() }),
  output: KioskSnapshotDto,
  entitlement: 'badges',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }) => {
    const { settings } = await kioskTx(tx, ctx, input.eventId);
    const tickets = await badgeTicketsTx(tx, { eventId: input.eventId });
    let adapter: 'browser' | 'printnode' = 'browser';
    if (settings.printerId) {
      const [p] = await tx
        .select({ adapter: printers.adapter })
        .from(printers)
        .where(eq(printers.id, settings.printerId));
      if (p?.adapter === 'printnode') adapter = 'printnode';
    }
    return {
      eventId: input.eventId,
      emailCodes: settings.emailCodes,
      adapter,
      asOf: ctx.now,
      badges: await kioskBadgesTx(tx, input.eventId, tickets),
    };
  },
});
