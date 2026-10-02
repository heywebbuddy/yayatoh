import { createHash, randomBytes } from 'node:crypto';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { FloorplanDoc, placedSeats } from '@yayatoh/floorplan';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ChartKey, chartKeyTx, onChart } from './chart.ts';
import { bestAvailable, type PlanSeat } from './domain/best-available.ts';
import { activeAdaRule, activeCompanionRule } from './domain/rules.ts';
import { checkSeatRulesTx, RuleHitDto, ruleStartTx, seatingRulesTx } from './rules.ts';
import { companionSeats, eventLayouts, eventSeats, selectionSettings } from './schema.ts';

/**
 * Best available and the ADA engine (M6.11a, entitlement `advanced_seating`).
 *
 * - The organizer offers "best available" per event and may score sections (`selection_settings`).
 * - Companion seats (`companion_seats`) sit next to accessible seats; with the `ada_companion`
 *   rule they are sold only with an accessible seat.
 * - A buyer (or the box office) asks for a number of seats at one price, optionally with a
 *   wheelchair-accessible space: the best block is chosen (`bestAvailable`, pure) and held in
 *   one claim. Pickers of the same chart are serialized by a transaction advisory lock, and each
 *   claim takes its rows `FOR UPDATE SKIP LOCKED` and only when every seat is still free, so a
 *   seat chosen meanwhile by hand is never double-held: the claim retries without it.
 * - The hold is a capability: the caller gets a random token; the seats are held under an id
 *   derived from it (never an order's id). Checkout and the box office adopt the hold into the
 *   order (`adoptSeatHoldTx`); it lapses like any hold (the sweeper).
 */

/** How long seats chosen by best available wait for checkout. */
export const BEST_AVAILABLE_HOLD_MINUTES = 10;
/** The largest party best available seats in one request. */
export const MAX_BEST_AVAILABLE = 20;
/** Section scores: 0 (worst) to 100 (best). */
export const MAX_SECTION_SCORE = 100;
/** Companion seats one event may mark (a large room's accessible rows). */
export const MAX_COMPANION_SEATS = 2_000;
const CLAIM_ATTEMPTS = 5;

const SectionScores = z.record(z.uuid(), z.int().min(0).max(MAX_SECTION_SCORE));

export const SelectionSettingsDto = z.object({
  bestAvailable: z.boolean(),
  sectionScores: SectionScores,
});
export type SelectionSettingsDto = z.infer<typeof SelectionSettingsDto>;

/** The event's best-available settings (defaults when never set: off, no scores). */
export async function selectionSettingsTx(tx: TenantTx, eventId: string): Promise<SelectionSettingsDto> {
  const [row] = await tx
    .select({
      bestAvailable: selectionSettings.bestAvailable,
      sectionScores: selectionSettings.sectionScores,
    })
    .from(selectionSettings)
    .where(eq(selectionSettings.eventId, eventId));
  const parsed = SelectionSettingsDto.safeParse(row ?? {});
  return parsed.success ? parsed.data : { bestAvailable: false, sectionScores: {} };
}

/** The event's companion seats (seat ids). */
export async function companionSeatsTx(tx: TenantTx, eventId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ seatUuid: companionSeats.seatUuid })
    .from(companionSeats)
    .where(eq(companionSeats.eventId, eventId));
  return new Set(rows.map((r) => r.seatUuid));
}

async function eventPlanDocTx(tx: TenantTx, eventId: string): Promise<FloorplanDoc> {
  const [layout] = await tx
    .select({ doc: eventLayouts.doc })
    .from(eventLayouts)
    .where(onChart(eventLayouts, eventId, null));
  if (!layout) throw new DomainError('not_found', 'This event has no floor plan', { reason: 'no_plan' });
  return FloorplanDoc.parse(layout.doc);
}

// ─── The organizer's page ───────────────────────────────────────────────────────────────────

export const SelectionPageDto = z.object({
  settings: SelectionSettingsDto,
  sections: z.array(z.object({ id: z.uuid(), label: z.string() })),
  /** Rows and tables with an accessible seat, every seat with its flags (companions are chosen here). */
  groups: z.array(
    z.object({
      itemId: z.uuid(),
      kind: z.enum(['row', 'table']),
      label: z.string(),
      seats: z.array(
        z.object({
          seatUuid: z.uuid(),
          label: z.string(),
          accessible: z.boolean(),
          companion: z.boolean(),
          /** Next to an accessible seat: the engine suggests it as a companion seat. */
          suggested: z.boolean(),
        }),
      ),
    }),
  ),
  /** Seats marked as companions that are no longer in a group with an accessible seat. */
  companionCount: z.int(),
});
export type SelectionPageDto = z.infer<typeof SelectionPageDto>;

/** Seats next to an accessible seat: the neighbours in its row, or at its table. */
export function companionSuggestions(doc: FloorplanDoc): Set<string> {
  const out = new Set<string>();
  for (const item of doc.items) {
    if (item.kind === 'object') continue;
    const n = item.seats.length;
    item.seats.forEach((s, i) => {
      if (!s.accessible) return;
      const near = item.kind === 'row' ? [i - 1, i + 1] : [(i - 1 + n) % n, (i + 1) % n];
      for (const j of near) {
        const seat = item.seats[j];
        if (seat && !seat.accessible) out.add(seat.id);
      }
    });
  }
  return out;
}

export const selectionPageQuery = tenantQuery({
  name: 'seating.selectionPage',
  input: z.object({ eventId: z.uuid() }),
  output: SelectionPageDto,
  entitlement: 'advanced_seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const doc = await eventPlanDocTx(tx, input.eventId);
    const settings = await selectionSettingsTx(tx, input.eventId);
    const companions = await companionSeatsTx(tx, input.eventId);
    const suggested = companionSuggestions(doc);
    return {
      settings,
      sections: doc.sections.map((s) => ({ id: s.id, label: s.label })),
      groups: doc.items.flatMap((item) =>
        item.kind === 'object' || !item.seats.some((s) => s.accessible)
          ? []
          : [
              {
                itemId: item.id,
                kind: item.kind,
                label: item.label,
                seats: item.seats.map((s) => ({
                  seatUuid: s.id,
                  label: s.label,
                  accessible: s.accessible,
                  companion: companions.has(s.id),
                  suggested: suggested.has(s.id),
                })),
              },
            ],
      ),
      companionCount: companions.size,
    };
  },
});

/**
 * Offer best available (or stop) and score sections. Scores name sections of the event plan;
 * an unknown section is refused.
 */
export const setSelectionSettingsCommand = tenantCommand({
  name: 'seating.setSelectionSettings',
  input: z.object({
    eventId: z.uuid(),
    bestAvailable: z.boolean(),
    sectionScores: SectionScores.default({}),
  }),
  output: SelectionSettingsDto,
  entitlement: 'advanced_seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const doc = await eventPlanDocTx(tx, input.eventId);
    const known = new Set(doc.sections.map((s) => s.id));
    if (Object.keys(input.sectionScores).some((id) => !known.has(id)))
      throw new DomainError('validation_failed', 'That section is not in the plan', {
        reason: 'unknown_section',
        field: 'sectionScores',
      });
    await tx
      .insert(selectionSettings)
      .values({
        orgId,
        eventId: input.eventId,
        bestAvailable: input.bestAvailable,
        sectionScores: input.sectionScores,
      })
      .onConflictDoUpdate({
        target: [selectionSettings.orgId, selectionSettings.eventId],
        set: { bestAvailable: input.bestAvailable, sectionScores: input.sectionScores, updatedAt: ctx.now },
      });
    return selectionSettingsTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'seating.selection_settings_set',
    targetType: 'event',
    targetId: input.eventId,
    data: { bestAvailable: input.bestAvailable, scoredSections: Object.keys(input.sectionScores).length },
  }),
});

/**
 * Mark the event's companion seats (the whole set: seats left out stop being companions). A
 * companion seat sits in a row or at a table with an accessible seat, and is not one itself.
 */
export const setCompanionSeatsCommand = tenantCommand({
  name: 'seating.setCompanionSeats',
  input: z.object({ eventId: z.uuid(), seatUuids: z.array(z.uuid()).max(MAX_COMPANION_SEATS) }),
  output: z.object({ count: z.int() }),
  entitlement: 'advanced_seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const doc = await eventPlanDocTx(tx, input.eventId);
    const wanted = [...new Set(input.seatUuids)];
    const eligible = new Map<string, 'ok' | 'accessible'>();
    for (const item of doc.items) {
      if (item.kind === 'object' || !item.seats.some((s) => s.accessible)) continue;
      for (const s of item.seats) eligible.set(s.id, s.accessible ? 'accessible' : 'ok');
    }
    const bad = wanted.find((id) => eligible.get(id) !== 'ok');
    if (bad)
      throw new DomainError('validation_failed', 'A companion seat sits next to an accessible seat', {
        reason: eligible.get(bad) === 'accessible' ? 'companion_is_accessible' : 'companion_far',
        seatUuid: bad,
      });
    await tx.delete(companionSeats).where(eq(companionSeats.eventId, input.eventId));
    if (wanted.length)
      await tx
        .insert(companionSeats)
        .values(wanted.map((seatUuid) => ({ orgId, eventId: input.eventId, seatUuid, updatedAt: ctx.now })));
    return { count: wanted.length };
  },
  audit: (input) => ({
    action: 'seating.companion_seats_set',
    targetType: 'event',
    targetId: input.eventId,
    data: { count: new Set(input.seatUuids).size },
  }),
});

// ─── Holding the best seats ─────────────────────────────────────────────────────────────────

/** The id a best-available hold has: derived from its token, so only the token's holder can use it. */
export function holdIdForToken(token: string): string {
  const h = createHash('sha256').update(`seating.best-available:${token}`).digest('hex');
  // Shaped as a UUIDv4 (random); order ids are UUIDv7, so the two never meet.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const HoldToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

export const HeldSeatDto = z.object({
  seatUuid: z.uuid(),
  label: z.string(),
  ticketTypeId: z.uuid(),
  accessible: z.boolean(),
  companion: z.boolean(),
});

export const BestAvailableHoldDto = z.object({
  /** Posted back with the order; the seats are held under it until `expiresAt`. */
  token: HoldToken,
  expiresAt: z.date(),
  seats: z.array(HeldSeatDto),
  /** 1 = the party sits together; more = split (no block fitted), and the buyer is told. */
  pieces: z.int(),
  /** Rule warnings for staff (enforced rules refuse). */
  warnings: z.array(RuleHitDto),
});
export type BestAvailableHoldDto = z.infer<typeof BestAvailableHoldDto>;

const BestAvailableInput = z.object({
  eventId: z.uuid(),
  occurrenceId: z.uuid().optional(),
  ticketTypeId: z.uuid(),
  quantity: z.int().min(1).max(MAX_BEST_AVAILABLE),
  /** Someone in the party needs a wheelchair-accessible space (the buyer says so). */
  accessible: z.boolean().default(false),
  /** A hold this buyer had (choosing again gives it back first). */
  replaceToken: HoldToken.optional(),
});

/** Every seat of the chart, placed (geometry for the ranking) and flagged. */
async function planSeatsTx(
  tx: TenantTx,
  eventId: string,
  key: ChartKey,
  doc: FloorplanDoc,
  free: (s: {
    status: string;
    ticketTypeId: string | null;
    accessible: boolean;
    companion: boolean;
  }) => boolean,
) {
  const companions = await companionSeatsTx(tx, eventId);
  const rows = await tx
    .select({
      seatUuid: eventSeats.seatUuid,
      status: eventSeats.status,
      ticketTypeId: eventSeats.ticketTypeId,
      accessible: eventSeats.accessible,
      label: eventSeats.label,
    })
    .from(eventSeats)
    .where(onChart(eventSeats, eventId, key));
  const state = new Map(rows.map((r) => [r.seatUuid, r]));
  const placed = new Map(placedSeats(doc).map((p) => [p.seatId, p]));
  const seats: PlanSeat[] = [];
  doc.items.forEach((item, order) => {
    if (item.kind === 'object') return;
    item.seats.forEach((s, index) => {
      const row = state.get(s.id);
      const at = placed.get(s.id);
      if (!row || !at) return;
      const companion = companions.has(s.id);
      seats.push({
        seatUuid: s.id,
        itemId: item.id,
        itemKind: item.kind,
        itemOrder: order,
        index,
        sectionId: item.sectionId,
        x: at.x,
        y: at.y,
        accessible: row.accessible,
        companion,
        free: free({ ...row, companion }),
      });
    });
  });
  const stages = doc.items.flatMap((i) => {
    if (i.kind !== 'object' || i.objectType !== 'stage') return [];
    const r = (i.rotation * Math.PI) / 180;
    const cx = i.width / 2;
    const cy = i.height / 2;
    return [{ x: i.x + cx * Math.cos(r) - cy * Math.sin(r), y: i.y + cx * Math.sin(r) + cy * Math.cos(r) }];
  });
  return { seats, stages, state, companions };
}

/**
 * Choose and hold the best seats for a party, in the caller's transaction. Refuses with
 * `not_enough_seats` or `no_accessible_seat`; holds every chosen seat or none.
 */
export async function holdBestAvailableTx(
  tx: TenantTx,
  ctx: Ctx,
  r: {
    eventId: string;
    occurrenceId?: string | null;
    ticketTypeId: string;
    quantity: number;
    accessible: boolean;
    holdId: string;
    expiresAt: Date;
  },
): Promise<{ seats: z.infer<typeof HeldSeatDto>[]; pieces: number }> {
  const orgId = requireOrg(ctx);
  const key = await chartKeyTx(tx, r.eventId, r.occurrenceId);
  const [layout] = await tx
    .select({ status: eventLayouts.status, doc: eventLayouts.doc })
    .from(eventLayouts)
    .where(onChart(eventLayouts, r.eventId, key));
  if (!layout || layout.status === 'draft')
    throw new DomainError('invalid_state', 'Seats are not on sale', { reason: 'seats_not_on_sale' });
  const doc = FloorplanDoc.parse(layout.doc);
  // One best-available picker per chart at a time: they never fight over the same block.
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`seating.best:${orgId}:${r.eventId}:${key ?? 'plan'}`}, 0))`,
  );
  await tx.execute(sql`set local lock_timeout = '2s'`);
  const rules = await seatingRulesTx(tx, r.eventId);
  const startsAt = (await ruleStartTx(tx, r.eventId, r.occurrenceId)) ?? ctx.now;
  // Seats kept back for those who need them are never picked for anyone else, warned or not.
  const adaKept = activeAdaRule(rules, startsAt, ctx.now) !== null;
  const companionRule = activeCompanionRule(rules, startsAt, ctx.now);
  const { sectionScores } = await selectionSettingsTx(tx, r.eventId);
  const contended = new Set<string>();
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const plan = await planSeatsTx(
      tx,
      r.eventId,
      key,
      doc,
      (s) =>
        s.status === 'available' &&
        s.ticketTypeId === r.ticketTypeId &&
        (r.accessible || !(adaKept && s.accessible)) &&
        (r.accessible || !(companionRule && s.companion)),
    );
    const pick = bestAvailable({
      seats: plan.seats.map((s) => (contended.has(s.seatUuid) ? { ...s, free: false } : s)),
      quantity: r.quantity,
      stages: plan.stages,
      sectionScores,
      accessible: r.accessible ? 1 : 0,
      companionsPerAccessible: r.accessible ? (companionRule?.maxPerAccessible ?? null) : null,
    });
    if (typeof pick === 'string')
      throw new DomainError('conflict', 'Not enough seats together at that price', { reason: pick });
    // Claim every seat or none: rows someone else is holding right now are skipped, so a short
    // count means a seat went meanwhile; the savepoint lets those rows go, and we choose again.
    const claimed = await tx
      .transaction(async (sp) => {
        const rows = await sp
          .update(eventSeats)
          .set({
            status: 'held',
            holdId: r.holdId,
            holdExpiresAt: r.expiresAt,
            heldForOccurrenceId: key === null ? (r.occurrenceId ?? null) : null,
            updatedAt: ctx.now,
          })
          .where(
            inArray(
              eventSeats.id,
              sp
                .select({ id: eventSeats.id })
                .from(eventSeats)
                .where(
                  and(
                    onChart(eventSeats, r.eventId, key),
                    inArray(eventSeats.seatUuid, pick.seats),
                    eq(eventSeats.status, 'available'),
                  ),
                )
                .for('update', { skipLocked: true }),
            ),
          )
          .returning({ seatUuid: eventSeats.seatUuid });
        if (rows.length !== pick.seats.length) throw new ClaimMissed(rows.map((x) => x.seatUuid));
        return rows;
      })
      .catch((err: unknown) => {
        if (err instanceof ClaimMissed) {
          for (const id of pick.seats) if (!err.got.includes(id)) contended.add(id);
          return null;
        }
        throw err;
      });
    if (!claimed) continue;
    return {
      pieces: pick.pieces,
      seats: pick.seats.map((id) => {
        const s = plan.state.get(id);
        return {
          seatUuid: id,
          label: s?.label ?? '',
          ticketTypeId: r.ticketTypeId,
          accessible: s?.accessible ?? false,
          companion: plan.companions.has(id),
        };
      }),
    };
  }
  throw new DomainError('conflict', 'Those seats were just taken', { reason: 'seats_taken' });
}

class ClaimMissed extends Error {
  readonly got: string[];
  constructor(got: string[]) {
    super('claim missed');
    this.got = got;
  }
}

/** A published event the public may buy for (private events go through checkout's own access). */
async function publicEventTx(tx: TenantTx, eventId: string) {
  const event = await findEventTx(tx, eventId);
  if (event?.status !== 'published' || event.visibility === 'private')
    throw new DomainError('not_found', 'Event not found');
  return event;
}

async function releaseTokenTx(tx: TenantTx, ctx: Ctx, eventId: string, token: string): Promise<number> {
  const rows = await tx
    .update(eventSeats)
    .set({
      status: 'available',
      holdId: null,
      holdExpiresAt: null,
      heldForOccurrenceId: null,
      updatedAt: ctx.now,
    })
    .where(
      and(
        eq(eventSeats.eventId, eventId),
        eq(eventSeats.holdId, holdIdForToken(token)),
        eq(eventSeats.status, 'held'),
      ),
    )
    .returning({ id: eventSeats.id });
  return rows.length;
}

async function bestAvailableHoldTx(
  tx: TenantTx,
  ctx: Ctx,
  input: z.output<typeof BestAvailableInput>,
  context: 'checkout' | 'box_office',
  override: boolean,
) {
  const settings = await selectionSettingsTx(tx, input.eventId);
  if (!settings.bestAvailable)
    throw new DomainError('invalid_state', 'Best available is not offered for this event', {
      reason: 'best_available_off',
    });
  if (input.replaceToken) await releaseTokenTx(tx, ctx, input.eventId, input.replaceToken);
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(ctx.now.getTime() + BEST_AVAILABLE_HOLD_MINUTES * 60_000);
  const held = await holdBestAvailableTx(tx, ctx, {
    ...input,
    occurrenceId: input.occurrenceId ?? null,
    holdId: holdIdForToken(token),
    expiresAt,
  });
  // The same rules as choosing by hand (enforced ones refuse and the hold rolls back).
  const warnings = await checkSeatRulesTx(tx, ctx, {
    eventId: input.eventId,
    occurrenceId: input.occurrenceId ?? null,
    seatUuids: held.seats.map((s) => s.seatUuid),
    context,
    override,
    accessibleNeed: input.accessible,
  });
  return { token, expiresAt, seats: held.seats, pieces: held.pieces, warnings };
}

/** Best available for a buyer online (public). */
export const holdBestAvailableCommand = tenantCommand({
  name: 'seating.holdBestAvailable',
  input: BestAvailableInput,
  output: BestAvailableHoldDto,
  entitlement: 'advanced_seating',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx }) => {
    await publicEventTx(tx, input.eventId);
    return bestAvailableHoldTx(tx, ctx, input, 'checkout', false);
  },
  audit: (input, r) => ({
    action: 'seating.best_available_held',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      quantity: input.quantity,
      pieces: r?.pieces,
      ...(input.accessible ? { accessibleNeed: true } : {}),
    },
  }),
});

/** Best available at the box office: staff may sell despite an enforced rule (audited). */
export const holdBestAvailableStaffCommand = tenantCommand({
  name: 'seating.holdBestAvailableStaff',
  input: BestAvailableInput.extend({ overrideRules: z.boolean().default(false) }),
  output: BestAvailableHoldDto,
  entitlement: 'advanced_seating',
  permission: 'orders:sell',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    return bestAvailableHoldTx(tx, ctx, input, 'box_office', input.overrideRules);
  },
  audit: (input, r) => ({
    action: 'seating.best_available_held',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      quantity: input.quantity,
      pieces: r?.pieces,
      via: 'box_office',
      ...(input.accessible ? { accessibleNeed: true } : {}),
      ...(input.overrideRules ? { overrideRules: true } : {}),
    },
  }),
});

/** Give a best-available hold back (the buyer chose again, or chose by hand instead). */
export const releaseBestAvailableCommand = tenantCommand({
  name: 'seating.releaseBestAvailable',
  input: z.object({ eventId: z.uuid(), token: HoldToken }),
  output: z.object({ released: z.int() }),
  entitlement: 'advanced_seating',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx }) => ({
    released: await releaseTokenTx(tx, ctx, input.eventId, input.token),
  }),
  audit: (input, r) => ({
    action: 'seating.best_available_released',
    targetType: 'event',
    targetId: input.eventId,
    data: { released: r?.released },
  }),
});

/**
 * An order takes over a best-available hold (checkout, the box office): the seats move to the
 * order's hold, until `expiresAt`. A lapsed or unknown token is refused (`seat_hold_expired`).
 */
export async function adoptSeatHoldTx(
  tx: TenantTx,
  ctx: Ctx,
  a: { eventId: string; occurrenceId?: string | null; token: string; holdId: string; expiresAt: Date },
): Promise<{ seatUuid: string; ticketTypeId: string | null; label: string }[]> {
  if (!HoldToken.safeParse(a.token).success)
    throw new DomainError('conflict', 'Those seats are no longer held', { reason: 'seat_hold_expired' });
  const key = await chartKeyTx(tx, a.eventId, a.occurrenceId);
  const rows = await tx
    .update(eventSeats)
    .set({ holdId: a.holdId, holdExpiresAt: a.expiresAt, updatedAt: ctx.now })
    .where(
      and(
        onChart(eventSeats, a.eventId, key),
        eq(eventSeats.holdId, holdIdForToken(a.token)),
        eq(eventSeats.status, 'held'),
        gt(eventSeats.holdExpiresAt, ctx.now),
      ),
    )
    .returning({
      seatUuid: eventSeats.seatUuid,
      ticketTypeId: eventSeats.ticketTypeId,
      label: eventSeats.label,
    });
  if (rows.length === 0)
    throw new DomainError('conflict', 'Those seats are no longer held', { reason: 'seat_hold_expired' });
  return rows;
}
