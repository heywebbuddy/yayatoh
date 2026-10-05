import { createHash } from 'node:crypto';
import { sessionVisitsTx } from '@yayatoh/checkin';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { eventDeliveryTx } from '@yayatoh/events';
import { createCtx, DomainError, type DomainEvent, requireOrg, stableStringify } from '@yayatoh/kernel';
import { orderLocalesTx } from '@yayatoh/orders';
import {
  defineSubscriber,
  type Notifier,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import { sessionsOf } from '@yayatoh/program';
import { organizationNameTx } from '@yayatoh/tenancy';
import { eventHoldersTx } from '@yayatoh/ticketing';
import { onlineAttendanceTx } from '@yayatoh/virtual';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type CertificateDocInput, certificateEmailBody, certificateLocale } from './certificate-document.ts';
import {
  type AttendanceFacts,
  type CreditRule,
  formatCredits,
  MAX_CREDITS,
  MAX_MIN_MINUTES,
  maskedName,
  newVerificationCode,
  normalizeCode,
  type SessionCredit,
  sessionCredit,
  totalCredits,
} from './domain/credits.ts';
import { CalculationDto, CeSetupDto, SessionRuleDto, VerificationDto } from './dto.ts';
import { CERTIFICATE_COPY, CERTIFICATE_COPY_VERSION } from './legal/certificate-copy.ts';
import { awards, certificates, sessionRules, settings } from './schema.ts';

/**
 * CE credits (M6.9b). The organizer gives sessions a credit rule (credits, minimum minutes, which
 * attendance counts), then calculates: for every active ticket, each ended session's minutes from
 * session door scans (`checkin`), heartbeat watch time and Zoom attendance (`virtual`), and a
 * certificate for whoever reached at least one minimum. Entitlement `virtual` (P6-13: virtual and
 * hybrid); reads `events:read`, changes `events:write`. Certificates are emailed to the ticket
 * holder (`ce.certificate_issued@1` → the mailer) and downloadable by a signed link.
 */

type CertificateRow = typeof certificates.$inferSelect;

export const CERTIFICATE_PURPOSE = 'ce.certificate';
export const CERTIFICATE_ISSUED_EVENT = 'ce.certificate_issued';
export const CERTIFICATE_REVOKED_EVENT = 'ce.certificate_revoked';

/** The holder's download token (HMAC-signed id; it goes only to the holder's email and order page). */
export const certificateToken = (certificateId: string) => signLinkToken(CERTIFICATE_PURPOSE, certificateId);

// The locale came from the holder's order; only a well-formed tag goes into a URL.
const localePrefix = (locale: string) =>
  locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';

/** The holder's PDF link (org id in the path: the tenant comes from the route, never a header). */
export const certificateUrl = (appOrigin: string, c: { orgId: string; id: string; locale: string }) =>
  `${appOrigin}${localePrefix(c.locale)}/certificates/${c.orgId}/${certificateToken(c.id)}`;

/** The public verification page of a code. */
export const verifyUrl = (appOrigin: string, c: { orgId: string; code: string; locale?: string }) =>
  `${appOrigin}${localePrefix(c.locale ?? 'en')}/certificates/${c.orgId}/verify/${c.code}`;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function eventOrThrowTx(tx: TenantTx, eventId: string) {
  const ev = await eventDeliveryTx(tx, eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  return ev;
}

async function settingsTx(tx: TenantTx, eventId: string) {
  const [row] = await tx.select().from(settings).where(eq(settings.eventId, eventId));
  return row ?? null;
}

/* ------------------------------------------------------------------------- setup ---- */

export const ceSetupQuery = tenantQuery({
  name: 'ce.setup',
  input: z.object({ eventId: z.uuid() }),
  output: CeSetupDto,
  entitlement: 'virtual',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventOrThrowTx(tx, input.eventId);
    const s = await settingsTx(tx, ev.id);
    const rules = new Map(
      (await tx.select().from(sessionRules).where(eq(sessionRules.eventId, ev.id))).map((r) => [
        r.sessionId,
        r,
      ]),
    );
    const awarded = new Map(
      (
        await tx
          .select({ sessionId: awards.sessionId, n: sql<number>`count(*)::int` })
          .from(awards)
          .innerJoin(certificates, eq(certificates.id, awards.certificateId))
          .where(and(eq(awards.eventId, ev.id), eq(certificates.status, 'issued')))
          .groupBy(awards.sessionId)
      ).map((r) => [r.sessionId, r.n]),
    );
    const certs = await tx
      .select()
      .from(certificates)
      .where(eq(certificates.eventId, ev.id))
      .orderBy(asc(certificates.holderName), asc(certificates.id));
    return {
      eventId: ev.id,
      creditLabel: s?.creditLabel ?? null,
      accreditor: s?.accreditor ?? null,
      calculatedAt: s?.calculatedAt ?? null,
      sessions: (await sessionsOf(tx, ev.id))
        .filter((x) => !x.draft)
        .map((x) => {
          const r = rules.get(x.id);
          return {
            sessionId: x.id,
            title: x.title,
            startsAt: x.startsAt,
            endsAt: x.endsAt,
            ended: x.endsAt <= ctx.now,
            rule: r
              ? {
                  credits: r.credits,
                  minMinutes: r.minMinutes,
                  countInPerson: r.countInPerson,
                  countVirtual: r.countVirtual,
                }
              : null,
            awarded: awarded.get(x.id) ?? 0,
          };
        }),
      certificates: certs.map((c) => ({
        id: c.id,
        holderName: c.holderName,
        code: c.code,
        totalCredits: c.totalCredits,
        revision: c.revision,
        status: c.status as 'issued' | 'revoked',
        issuedAt: c.issuedAt,
      })),
    };
  },
});

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim() || null)
    .nullable()
    .default(null);

/** The credit's name and the accrediting body printed on the event's certificates. */
export const setCeSettingsCommand = tenantCommand({
  name: 'ce.setSettings',
  input: z.object({ eventId: z.uuid(), creditLabel: optionalText(60), accreditor: optionalText(120) }),
  output: z.object({ creditLabel: z.string().nullable(), accreditor: z.string().nullable() }),
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOrThrowTx(tx, input.eventId);
    const values = { creditLabel: input.creditLabel, accreditor: input.accreditor };
    await tx
      .insert(settings)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, ...values })
      .onConflictDoUpdate({
        target: [settings.orgId, settings.eventId],
        set: { ...values, updatedAt: ctx.now },
      });
    return values;
  },
  audit: (input) => ({ action: 'ce.settings.set', targetType: 'event', targetId: input.eventId, data: {} }),
});

export const SetSessionRuleInput = z
  .object({
    eventId: z.uuid(),
    sessionId: z.uuid(),
    credits: z.int().min(1).max(MAX_CREDITS),
    minMinutes: z.int().min(1).max(MAX_MIN_MINUTES),
    countInPerson: z.boolean(),
    countVirtual: z.boolean(),
  })
  .refine((v) => v.countInPerson || v.countVirtual, { path: ['countInPerson'], message: 'count_nothing' });

/** A session's credit rule (one per session; saving again replaces it). */
export const setSessionRuleCommand = tenantCommand({
  name: 'ce.setSessionRule',
  input: SetSessionRuleInput,
  output: SessionRuleDto,
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventOrThrowTx(tx, input.eventId);
    const s = (await sessionsOf(tx, ev.id)).find((x) => x.id === input.sessionId && !x.draft);
    if (!s) throw new DomainError('not_found', 'Session not found', { field: 'sessionId' });
    const rule = {
      credits: input.credits,
      minMinutes: input.minMinutes,
      countInPerson: input.countInPerson,
      countVirtual: input.countVirtual,
    };
    await tx
      .insert(sessionRules)
      .values({ orgId: requireOrg(ctx), eventId: ev.id, sessionId: s.id, ...rule })
      .onConflictDoUpdate({
        target: [sessionRules.orgId, sessionRules.sessionId],
        set: { ...rule, updatedAt: ctx.now },
      });
    return rule;
  },
  audit: (input) => ({
    action: 'ce.rule.set',
    targetType: 'session',
    targetId: input.sessionId,
    data: {
      eventId: input.eventId,
      credits: input.credits,
      minMinutes: input.minMinutes,
      countInPerson: input.countInPerson,
      countVirtual: input.countVirtual,
    },
  }),
});

/** Take a session's credits away (the next calculation drops them from every certificate). */
export const removeSessionRuleCommand = tenantCommand({
  name: 'ce.removeSessionRule',
  input: z.object({ eventId: z.uuid(), sessionId: z.uuid() }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const out = await tx
      .delete(sessionRules)
      .where(and(eq(sessionRules.eventId, input.eventId), eq(sessionRules.sessionId, input.sessionId)))
      .returning({ id: sessionRules.id });
    return { removed: out.length > 0 };
  },
  audit: (input) => ({
    action: 'ce.rule.remove',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId },
  }),
});

/* ------------------------------------------------------------------- calculation ---- */

type CertificatePayload = {
  orgId: string;
  eventId: string;
  certificateId: string;
  ticketId: string;
  revision: number;
};
const issuedEvent = (p: CertificatePayload): DomainEvent => ({
  type: 'ce.certificate_issued',
  version: 1,
  aggregateType: 'event',
  aggregateId: p.eventId,
  payload: p,
});
const revokedEvent = (p: CertificatePayload): DomainEvent => ({
  type: 'ce.certificate_revoked',
  version: 1,
  aggregateType: 'event',
  aggregateId: p.eventId,
  payload: p,
});

/** Every ticket's attendance facts per session (ids and times only). */
async function factsTx(tx: TenantTx, eventId: string) {
  const out = new Map<
    string,
    {
      visits: AttendanceFacts['visits'][number][];
      watchMinutes: Date[];
      zoom: AttendanceFacts['zoom'][number][];
    }
  >();
  const at = (sessionId: string, ticketId: string) => {
    const k = `${sessionId}:${ticketId}`;
    let f = out.get(k);
    if (!f) {
      f = { visits: [], watchMinutes: [], zoom: [] };
      out.set(k, f);
    }
    return f;
  };
  for (const v of await sessionVisitsTx(tx, eventId))
    at(v.sessionId, v.ticketId).visits.push({ from: v.inAt, to: v.outAt });
  const online = await onlineAttendanceTx(tx, eventId);
  for (const w of online.watched) at(w.sessionId, w.ticketId).watchMinutes.push(w.minute);
  for (const z of online.zoom) at(z.sessionId, z.ticketId).zoom.push({ from: z.joinedAt, to: z.leftAt });
  return (sessionId: string, ticketId: string): AttendanceFacts =>
    out.get(`${sessionId}:${ticketId}`) ?? { visits: [], watchMinutes: [], zoom: [] };
}

/** What a certificate says, hashed: a recalculation with the same result changes nothing. */
const contentHash = (c: {
  holderName: string;
  creditLabel: string | null;
  accreditor: string | null;
  sessions: readonly SessionCredit[];
}) =>
  sha256(
    stableStringify({
      holderName: c.holderName,
      creditLabel: c.creditLabel,
      accreditor: c.accreditor,
      sessions: [...c.sessions]
        .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
        .map((s) => [s.sessionId, s.inPersonMinutes, s.virtualMinutes, s.minutes, s.credits]),
    }),
  );

/**
 * Calculate the event's CE credits and issue, revise or withdraw certificates. Only ended sessions
 * with a rule count. Idempotent: the same scans and watch time give the same awards, the same
 * certificates and no new email; a changed result is a new revision (emailed again); a ticket that
 * no longer reaches any minimum (or was voided) has its certificate withdrawn.
 */
export const calculateCreditsCommand = tenantCommand({
  name: 'ce.calculate',
  input: z.object({ eventId: z.uuid() }),
  output: CalculationDto,
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const ev = await eventOrThrowTx(tx, input.eventId);
    // One calculation per event at a time: the settings row is the lock.
    await tx.insert(settings).values({ orgId, eventId: ev.id }).onConflictDoNothing();
    const [setting] = await tx.select().from(settings).where(eq(settings.eventId, ev.id)).for('update');
    if (!setting) throw new DomainError('internal');
    const sessions = new Map((await sessionsOf(tx, ev.id)).filter((s) => !s.draft).map((s) => [s.id, s]));
    const rules: CreditRule[] = [];
    let pendingSessions = 0;
    for (const r of await tx.select().from(sessionRules).where(eq(sessionRules.eventId, ev.id))) {
      const s = sessions.get(r.sessionId);
      if (!s) continue;
      if (s.endsAt > ctx.now) {
        pendingSessions += 1;
        continue;
      }
      rules.push({
        sessionId: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        minMinutes: r.minMinutes,
        credits: r.credits,
        countInPerson: r.countInPerson,
        countVirtual: r.countVirtual,
      });
    }
    const facts = await factsTx(tx, ev.id);
    const holders = await eventHoldersTx(tx, ev.id);
    const locales = await orderLocalesTx(
      tx,
      holders.map((h) => h.orderId),
    );
    const existing = new Map(
      (await tx.select().from(certificates).where(eq(certificates.eventId, ev.id))).map((c) => [
        c.ticketId,
        c,
      ]),
    );
    const counts = { issued: 0, revised: 0, revoked: 0, unchanged: 0, below: 0, pendingSessions };
    const active = new Set<string>();
    for (const h of holders) {
      active.add(h.id);
      const results = rules.map((r) => sessionCredit(r, facts(r.sessionId, h.id)));
      const earned = results.filter((r) => r.qualifies);
      const cert = existing.get(h.id);
      if (earned.length === 0) {
        if (results.some((r) => r.minutes > 0)) counts.below += 1;
        if (cert && cert.status === 'issued') {
          await revokeTx(tx, ctx.now, cert);
          emit(
            revokedEvent({
              orgId,
              eventId: ev.id,
              certificateId: cert.id,
              ticketId: h.id,
              revision: cert.revision,
            }),
          );
          counts.revoked += 1;
        }
        continue;
      }
      const holderName = h.holderName.slice(0, 200) || '—';
      const hash = contentHash({
        holderName,
        creditLabel: setting.creditLabel,
        accreditor: setting.accreditor,
        sessions: earned,
      });
      const total = totalCredits(earned);
      let row: CertificateRow;
      if (!cert) {
        const [created] = await tx
          .insert(certificates)
          .values({
            orgId,
            eventId: ev.id,
            ticketId: h.id,
            code: await freshCodeTx(tx),
            holderName,
            holderEmail: h.holderEmail.trim().toLowerCase().slice(0, 320),
            locale: certificateLocale(locales.get(h.orderId)),
            totalCredits: total,
            contentHash: hash,
            issuedAt: ctx.now,
            revisedAt: ctx.now,
            copyVersion: CERTIFICATE_COPY_VERSION,
          })
          .returning();
        if (!created) throw new DomainError('internal');
        row = created;
        counts.issued += 1;
      } else if (cert.contentHash === hash && cert.status === 'issued') {
        counts.unchanged += 1;
        continue;
      } else {
        const [updated] = await tx
          .update(certificates)
          .set({
            holderName,
            holderEmail: h.holderEmail.trim().toLowerCase().slice(0, 320),
            totalCredits: total,
            contentHash: hash,
            status: 'issued',
            revision: cert.revision + 1,
            revisedAt: ctx.now,
            copyVersion: CERTIFICATE_COPY_VERSION,
            updatedAt: ctx.now,
          })
          .where(eq(certificates.id, cert.id))
          .returning();
        if (!updated) throw new DomainError('internal');
        row = updated;
        counts.revised += 1;
      }
      await tx.delete(awards).where(eq(awards.certificateId, row.id));
      await tx.insert(awards).values(
        earned.map((e) => ({
          orgId,
          eventId: ev.id,
          certificateId: row.id,
          sessionId: e.sessionId,
          ticketId: h.id,
          inPersonMinutes: e.inPersonMinutes,
          virtualMinutes: e.virtualMinutes,
          minutes: e.minutes,
          credits: e.credits,
        })),
      );
      emit(
        issuedEvent({
          orgId,
          eventId: ev.id,
          certificateId: row.id,
          ticketId: h.id,
          revision: row.revision,
        }),
      );
    }
    // Voided tickets: their certificates are withdrawn.
    for (const cert of existing.values())
      if (!active.has(cert.ticketId) && cert.status === 'issued') {
        await revokeTx(tx, ctx.now, cert);
        emit(
          revokedEvent({
            orgId,
            eventId: ev.id,
            certificateId: cert.id,
            ticketId: cert.ticketId,
            revision: cert.revision,
          }),
        );
        counts.revoked += 1;
      }
    await tx
      .update(settings)
      .set({ calculatedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(settings.id, setting.id));
    return counts;
  },
  audit: (input, r) => ({
    action: 'ce.calculate',
    targetType: 'event',
    targetId: input.eventId,
    data: { issued: r.issued, revised: r.revised, revoked: r.revoked, unchanged: r.unchanged },
  }),
});

async function revokeTx(tx: TenantTx, now: Date, cert: CertificateRow) {
  await tx.delete(awards).where(eq(awards.certificateId, cert.id));
  await tx
    .update(certificates)
    .set({ status: 'revoked', totalCredits: 0, revisedAt: now, updatedAt: now })
    .where(eq(certificates.id, cert.id));
}

/** A verification code not used in this org yet. */
async function freshCodeTx(tx: TenantTx): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = newVerificationCode();
    const [hit] = await tx
      .select({ id: certificates.id })
      .from(certificates)
      .where(eq(certificates.code, code));
    if (!hit) return code;
  }
  throw new DomainError('internal', 'Could not pick a verification code');
}

/* ------------------------------------------------------------------ documents ---- */

/** A certificate's document fields (the PDF, the email body, the console). */
async function certificateDocTx(
  tx: TenantTx,
  c: CertificateRow,
  appOrigin: string,
): Promise<CertificateDocInput> {
  const ev = await eventDeliveryTx(tx, c.eventId);
  const s = await settingsTx(tx, c.eventId);
  const sessions = new Map((await sessionsOf(tx, c.eventId)).map((x) => [x.id, x]));
  const rows = await tx.select().from(awards).where(eq(awards.certificateId, c.id));
  return {
    code: c.code,
    revision: c.revision,
    status: c.status as 'issued' | 'revoked',
    holderName: c.holderName,
    eventName: ev?.name ?? '',
    orgName: (await organizationNameTx(tx, c.orgId)) ?? '',
    creditLabel: s?.creditLabel ?? null,
    accreditor: s?.accreditor ?? null,
    timeZone: ev?.timezone ?? 'UTC',
    issuedAt: c.issuedAt,
    revisedAt: c.revisedAt,
    totalCredits: c.totalCredits,
    sessions: rows
      .map((a) => ({ a, s: sessions.get(a.sessionId) }))
      .sort(
        (x, y) =>
          (x.s?.startsAt.getTime() ?? 0) - (y.s?.startsAt.getTime() ?? 0) ||
          (x.s?.title ?? '').localeCompare(y.s?.title ?? ''),
      )
      .map(({ a, s: session }) => ({
        title: session?.title ?? '',
        startsAt: session?.startsAt ?? c.issuedAt,
        inPersonMinutes: a.inPersonMinutes,
        virtualMinutes: a.virtualMinutes,
        minutes: a.minutes,
        credits: a.credits,
      })),
    verifyUrl: verifyUrl(appOrigin, { orgId: c.orgId, code: c.code, locale: c.locale }),
  };
}

export const CertificateDocumentDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  locale: z.string(),
  doc: z.custom<CertificateDocInput>(),
});
export type CertificateDocumentDto = z.infer<typeof CertificateDocumentDto>;

/** One certificate's document for the organizer's PDF (event readers). */
export function certificateDocumentQuery(appOrigin: string) {
  return tenantQuery({
    name: 'ce.certificateDocument',
    input: z.object({ eventId: z.uuid(), certificateId: z.uuid() }),
    output: CertificateDocumentDto,
    entitlement: 'virtual',
    permission: 'events:read',
    handler: async ({ input, tx }) => {
      const [c] = await tx.select().from(certificates).where(eq(certificates.id, input.certificateId));
      if (!c || c.eventId !== input.eventId) throw new DomainError('not_found', 'Certificate not found');
      return {
        id: c.id,
        eventId: c.eventId,
        locale: c.locale,
        doc: await certificateDocTx(tx, c, appOrigin),
      };
    },
  });
}

const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'ce.certificate' } });

/** The holder's certificate by its signed link (the public PDF route): null when not valid. */
export async function certificateByToken(
  orgId: string,
  token: string,
  appOrigin: string,
): Promise<CertificateDocumentDto | null> {
  const id = token.length > 200 ? null : verifyLinkToken(CERTIFICATE_PURPOSE, token);
  if (!id) return null;
  return withTenant(systemCtx(orgId), async (tx) => {
    const [c] = await tx.select().from(certificates).where(eq(certificates.id, id));
    return c
      ? { id: c.id, eventId: c.eventId, locale: c.locale, doc: await certificateDocTx(tx, c, appOrigin) }
      : null;
  });
}

/**
 * The public verification of a code (anyone holding the certificate): its status, a masked name,
 * the event and the credits. `not_found` for an unknown code (nothing else is said).
 */
export const verifyCertificateQuery = tenantQuery({
  name: 'ce.verify',
  input: z.object({ code: z.string().max(40) }),
  output: VerificationDto,
  entitlement: 'virtual',
  permission: 'public:ce',
  handler: async ({ input, ctx, tx }) => {
    const code = normalizeCode(input.code);
    if (!code) throw new DomainError('not_found');
    const [c] = await tx.select().from(certificates).where(eq(certificates.code, code));
    if (!c) throw new DomainError('not_found');
    const ev = await eventDeliveryTx(tx, c.eventId);
    const s = await settingsTx(tx, c.eventId);
    return {
      code: c.code,
      status: c.status as 'issued' | 'revoked',
      holder: maskedName(c.holderName),
      eventName: ev?.name ?? '',
      orgName: (await organizationNameTx(tx, requireOrg(ctx))) ?? '',
      creditLabel: s?.creditLabel ?? null,
      accreditor: s?.accreditor ?? null,
      totalCredits: c.totalCredits,
      revision: c.revision,
      issuedAt: c.issuedAt,
      revisedAt: c.revisedAt,
      timezone: ev?.timezone ?? 'UTC',
      locale: c.locale,
    };
  },
});

/**
 * The order page's certificate links: issued certificates of these tickets (the web passes the
 * tickets of an order whose manage link it verified). Ticket id → download token.
 */
export const certificateLinksQuery = tenantQuery({
  name: 'ce.certificateLinks',
  input: z.object({ eventId: z.uuid(), ticketIds: z.array(z.uuid()).max(500) }),
  output: z.array(z.object({ ticketId: z.uuid(), token: z.string() })),
  entitlement: 'virtual',
  permission: 'public:ce',
  handler: async ({ input, tx }) => {
    if (input.ticketIds.length === 0) return [];
    const rows = await tx
      .select({ id: certificates.id, ticketId: certificates.ticketId })
      .from(certificates)
      .where(
        and(
          eq(certificates.eventId, input.eventId),
          eq(certificates.status, 'issued'),
          inArray(certificates.ticketId, input.ticketIds),
        ),
      );
    return rows.map((r) => ({ ticketId: r.ticketId, token: certificateToken(r.id) }));
  },
});

/* ---------------------------------------------------------------------- mailer ---- */

const IssuedPayload = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  certificateId: z.uuid(),
  ticketId: z.uuid(),
  revision: z.int(),
});

/**
 * Certificates go to the ticket holder (outbox → worker; the dev drain in dev and e2e), once per
 * revision (dedupe key), with the PDF link and the certificate as text. A revision superseded or
 * withdrawn before the mailer ran is not sent.
 */
export function certificateMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'ce.certificate-mailer',
    events: ['ce.certificate_issued@1'],
    handle: async (tx, event) => {
      const p = IssuedPayload.parse(event.payload);
      const [c] = await tx.select().from(certificates).where(eq(certificates.id, p.certificateId));
      if (c?.status !== 'issued' || c.revision !== p.revision) return;
      const doc = await certificateDocTx(tx, c, deps.appOrigin);
      const lang = certificateLocale(c.locale);
      await deps.notifier.enqueue(tx, {
        kind: 'ce.certificate',
        to: {
          email: c.holderEmail,
          name: c.holderName,
          userId: null,
          locale: c.locale,
          timeZone: doc.timeZone,
        },
        params: {
          url: certificateUrl(deps.appOrigin, c),
          name: c.holderName,
          eventName: doc.eventName,
          credits: `${formatCredits(c.totalCredits, lang)} ${doc.creditLabel ?? CERTIFICATE_COPY[lang].defaultLabel}`,
          code: c.code,
          revision: c.revision,
          body: certificateEmailBody(doc, c.locale),
        },
        dedupeKey: `ce-certificate:${c.id}:${c.revision}`,
        eventId: c.eventId,
      });
    },
  });
}
