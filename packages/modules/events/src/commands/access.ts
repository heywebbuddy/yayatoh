import { isUniqueViolation, type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACCESS_ATTEMPT_WINDOW_MS,
  ACCESS_ATTEMPTS_PER_WINDOW,
  ACCESS_CODE_PATTERN,
  accessCodeProblem,
  normalizeAccessCode,
} from '../domain/access-code.ts';
import { sanitizeMarkdown } from '../domain/markdown.ts';
import { generateShortCode } from '../domain/short-code.ts';
import {
  AccessCodeDto,
  type AccessGrantDto,
  AccessGrantDto as Grant,
  PrivateInfoDto,
} from '../dto-content.ts';
import { events } from '../schema.ts';
import { accessCodeAttempts, accessCodes, eventPrivateInfo } from '../schema-content.ts';

async function assertEvent(tx: TenantTx, eventId: string) {
  const [e] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!e) throw new DomainError('not_found');
  return e;
}

const HttpsUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https:// link');

// ---------------------------------------------------------------- private info (M1.4d)

/** The organizer's view of the private info. Writers only: viewers never read it. */
export const privateInfoQuery = tenantQuery({
  name: 'events.privateInfo',
  input: z.object({ eventId: z.uuid() }),
  output: PrivateInfoDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    await assertEvent(tx, input.eventId);
    const [row] = await tx.select().from(eventPrivateInfo).where(eq(eventPrivateInfo.eventId, input.eventId));
    return row
      ? {
          eventId: row.eventId,
          body: row.body,
          joinUrl: row.joinUrl,
          joinOpensMinutes: row.joinOpensMinutes,
          updatedAt: row.updatedAt,
        }
      : { eventId: input.eventId, body: '', joinUrl: null, joinOpensMinutes: 30, updatedAt: null };
  },
});

export const setPrivateInfoCommand = tenantCommand({
  name: 'events.setPrivateInfo',
  input: z.object({
    eventId: z.uuid(),
    body: z
      .string()
      .max(20_000)
      .transform((v) => sanitizeMarkdown(v, 10_000)),
    joinUrl: HttpsUrl.nullable().default(null),
    joinOpensMinutes: z.number().int().min(0).max(1440).default(30),
  }),
  output: PrivateInfoDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await assertEvent(tx, input.eventId);
    const [row] = await tx
      .insert(eventPrivateInfo)
      .values({ ...input, orgId })
      .onConflictDoUpdate({
        target: [eventPrivateInfo.orgId, eventPrivateInfo.eventId],
        set: {
          body: input.body,
          joinUrl: input.joinUrl,
          joinOpensMinutes: input.joinOpensMinutes,
          updatedAt: ctx.now,
        },
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return {
      eventId: row.eventId,
      body: row.body,
      joinUrl: row.joinUrl,
      joinOpensMinutes: row.joinOpensMinutes,
      updatedAt: row.updatedAt,
    };
  },
  // Never the content: the audit log is readable by more roles than the private info.
  audit: (input) => ({
    action: 'event.private_info.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { hasJoinUrl: input.joinUrl !== null },
  }),
});

// ---------------------------------------------------------------- access codes (M1.4d)

const toDto = (r: typeof accessCodes.$inferSelect): AccessCodeDto => ({
  id: r.id,
  eventId: r.eventId,
  code: r.code,
  label: r.label,
  unlocksEvent: r.unlocksEvent,
  ticketTypeIds: r.ticketTypeIds,
  maxUses: r.maxUses,
  uses: r.uses,
  expiresAt: r.expiresAt,
  active: r.active,
  createdAt: r.createdAt,
});

export const CreateAccessCodeInput = z
  .object({
    eventId: z.uuid(),
    /** Empty: generate one. */
    code: z
      .string()
      .max(64)
      .transform(normalizeAccessCode)
      .pipe(z.union([z.literal(''), z.string().regex(ACCESS_CODE_PATTERN)]))
      .default(''),
    label: z.string().trim().max(120).nullable().default(null),
    unlocksEvent: z.boolean().default(false),
    /** Hidden ticket types of this event it unlocks (ticketing checks they belong to the event). */
    ticketTypeIds: z.array(z.uuid()).max(50).default([]),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
    expiresAt: z.coerce.date().nullable().default(null),
  })
  .refine((v) => v.unlocksEvent || v.ticketTypeIds.length > 0, {
    message: 'Choose what the code unlocks',
    path: ['unlocksEvent'],
  });

export const createAccessCodeCommand = tenantCommand({
  name: 'events.createAccessCode',
  input: CreateAccessCodeInput,
  output: AccessCodeDto,
  entitlement: 'access_codes',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await assertEvent(tx, input.eventId);
    if (input.expiresAt && input.expiresAt <= ctx.now)
      throw new DomainError('validation_failed', 'The expiry is in the past', {
        issues: [{ path: 'expiresAt', code: 'custom' }],
      });
    const code = input.code || generateShortCode(8).toUpperCase();
    try {
      const [row] = await tx
        .insert(accessCodes)
        .values({ ...input, code, orgId })
        .returning();
      if (!row) throw new DomainError('internal');
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err, 'access_codes_org_event_code_key'))
        throw new DomainError('conflict', 'This event already has that code', { field: 'code' });
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'event.access_code.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { accessCodeId: row.id },
  }),
});

export const setAccessCodeActiveCommand = tenantCommand({
  name: 'events.setAccessCodeActive',
  input: z.object({ eventId: z.uuid(), accessCodeId: z.uuid(), active: z.boolean() }),
  output: AccessCodeDto,
  entitlement: 'access_codes',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(accessCodes)
      .set({ active: input.active, updatedAt: ctx.now })
      .where(and(eq(accessCodes.id, input.accessCodeId), eq(accessCodes.eventId, input.eventId)))
      .returning();
    if (!row) throw new DomainError('not_found');
    return toDto(row);
  },
  audit: (input) => ({
    action: input.active ? 'event.access_code.activate' : 'event.access_code.deactivate',
    targetType: 'event',
    targetId: input.eventId,
    data: { accessCodeId: input.accessCodeId },
  }),
});

export const listAccessCodesQuery = tenantQuery({
  name: 'events.listAccessCodes',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(AccessCodeDto),
  entitlement: 'access_codes',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    (
      await tx
        .select()
        .from(accessCodes)
        .where(eq(accessCodes.eventId, input.eventId))
        .orderBy(desc(accessCodes.createdAt))
    ).map(toDto),
});

const RedeemResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), grant: Grant }),
  z.object({ ok: z.literal(false) }),
]);

/**
 * Public: try an access code for an event. Wrong, expired, inactive and used-up codes all get the
 * same `{ ok: false }` (no probing one condition at a time) and count as a failed attempt; after
 * `ACCESS_ATTEMPTS_PER_WINDOW` failures per client key and event the answer is `rate_limited`.
 * A success counts one use, atomically (the UPDATE only matches while uses are left).
 */
export const redeemAccessCodeCommand = tenantCommand({
  name: 'events.redeemAccessCode',
  input: z.object({ eventId: z.uuid(), code: z.string().max(64), clientKey: z.string().min(16).max(128) }),
  output: RedeemResult,
  entitlement: 'access_codes',
  permission: 'public:access_code',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const event = await assertEvent(tx, input.eventId);
    if (!['published', 'postponed'].includes(event.status)) throw new DomainError('not_found');
    const since = new Date(ctx.now.getTime() - ACCESS_ATTEMPT_WINDOW_MS);
    const [failed] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(accessCodeAttempts)
      .where(
        and(
          eq(accessCodeAttempts.eventId, input.eventId),
          eq(accessCodeAttempts.clientKey, input.clientKey),
          gt(accessCodeAttempts.createdAt, since),
        ),
      );
    if ((failed?.n ?? 0) >= ACCESS_ATTEMPTS_PER_WINDOW)
      throw new DomainError('rate_limited', 'Too many attempts; try again later');
    const code = normalizeAccessCode(input.code);
    const [row] = ACCESS_CODE_PATTERN.test(code)
      ? await tx
          .select()
          .from(accessCodes)
          .where(and(eq(accessCodes.eventId, input.eventId), eq(accessCodes.code, code)))
      : [];
    const claimed =
      row && accessCodeProblem(row, ctx.now, true) === null
        ? await tx
            .update(accessCodes)
            .set({ uses: sql`${accessCodes.uses} + 1`, updatedAt: ctx.now })
            .where(
              and(
                eq(accessCodes.id, row.id),
                eq(accessCodes.active, true),
                sql`(${accessCodes.maxUses} is null or ${accessCodes.uses} < ${accessCodes.maxUses})`,
              ),
            )
            .returning()
        : [];
    const hit = claimed[0];
    if (!hit) {
      await tx
        .insert(accessCodeAttempts)
        .values({ orgId, eventId: input.eventId, clientKey: input.clientKey, createdAt: ctx.now });
      return { ok: false as const };
    }
    return {
      ok: true as const,
      grant: {
        codeId: hit.id,
        unlocksEvent: hit.unlocksEvent,
        ticketTypeIds: hit.ticketTypeIds,
        expiresAt: hit.expiresAt,
      },
    };
  },
  audit: (input, out) => ({
    action: out.ok ? 'event.access_code.redeem' : 'event.access_code.fail',
    targetType: 'event',
    targetId: input.eventId,
    data: out.ok ? { accessCodeId: out.grant.codeId } : {},
  }),
});

/**
 * What an already-redeemed code still grants now (its id comes from the visitor's signed cookie):
 * active and not expired; the use limit no longer applies. Null when it lapsed.
 */
export async function accessGrantTx(
  tx: TenantTx,
  eventId: string,
  codeId: string,
  now: Date,
): Promise<AccessGrantDto | null> {
  const [row] = await tx
    .select()
    .from(accessCodes)
    .where(and(eq(accessCodes.id, codeId), eq(accessCodes.eventId, eventId)));
  if (!row || accessCodeProblem(row, now, false) !== null) return null;
  return {
    codeId: row.id,
    unlocksEvent: row.unlocksEvent,
    ticketTypeIds: row.ticketTypeIds,
    expiresAt: row.expiresAt,
  };
}

/** Server-side (public pages): `accessGrantTx` in the event's org, outside a command. */
export function accessGrant(
  orgId: string,
  eventId: string,
  codeId: string,
  now: Date = new Date(),
): Promise<AccessGrantDto | null> {
  return withTenant(createCtx({ orgId }), (tx) => accessGrantTx(tx, eventId, codeId, now));
}
