import { csvRow } from '@yayatoh/csv';
import type { TenantTx } from '@yayatoh/db';
import {
  AnswerError,
  checkRsvpAnswers,
  currentRsvpFormTx,
  publishRsvpFormTx,
  RSVP_FIELD_TYPES,
  type RsvpFormDefinition,
  RsvpFormDefinition as RsvpFormDefinitionSchema,
  type RsvpGuestContext,
  type RsvpQuestion,
  replaceRsvpResponsesTx,
  rsvpFormVersionsTx,
  rsvpResponsesTx,
} from '@yayatoh/forms';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordHistoryTx, seal, unseal } from './guests.ts';
import { eventOfTx, rsvpFactsTx } from './rsvp-state.ts';
import { guests, menuOptions, parties, type ResponseStatus } from './schema.ts';

/**
 * RSVP questions (M4.1e): the event's menu, the host's questions (the forms engine's `rsvp` kind,
 * versioned), the answers each guest of a household gives on the party's page (checked by the
 * server against what the guest can see, hidden answers rejected), the write-back to the guest
 * (meal → `guests.meal`, dietary and accessibility → the sealed private fields, P4-3), meal
 * counts per sub-event and the answers export. Private answers never reach history, audit data,
 * logs or the party's page.
 */

export const MAX_MENU_OPTIONS = 30;

/* ---------------------------------------------------------------------------------- menu ---- */

export const MenuOptionDto = z.object({
  id: z.uuid(),
  label: z.string(),
  notes: z.string().nullable(),
});
export type MenuOptionDto = z.infer<typeof MenuOptionDto>;

export async function menuTx(tx: TenantTx, eventId: string): Promise<MenuOptionDto[]> {
  const rows = await tx
    .select({ id: menuOptions.id, label: menuOptions.label, notes: menuOptions.notes })
    .from(menuOptions)
    .where(eq(menuOptions.eventId, eventId))
    .orderBy(asc(menuOptions.position), asc(menuOptions.createdAt));
  return rows;
}

export const menuQuery = tenantQuery({
  name: 'guests.menu',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(MenuOptionDto),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    return menuTx(tx, input.eventId);
  },
});

const MenuText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

/**
 * Add a menu option, or change one (`optionId`). A new label is written to every guest of the
 * event who chose the old one, so their meal follows the rename.
 */
export const saveMenuOptionCommand = tenantCommand({
  name: 'guests.saveMenuOption',
  input: z.object({
    eventId: z.uuid(),
    optionId: z.uuid().optional(),
    label: z.string().trim().min(1).max(80),
    notes: MenuText(200),
  }),
  output: MenuOptionDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOfTx(tx, input.eventId);
    const menu = await menuTx(tx, input.eventId);
    const clash = menu.find(
      (m) => m.id !== input.optionId && m.label.toLocaleLowerCase() === input.label.toLocaleLowerCase(),
    );
    if (clash)
      throw new DomainError('conflict', 'This menu already has that option', {
        reason: 'menu_label_taken',
        field: 'label',
      });
    if (!input.optionId) {
      if (menu.length >= MAX_MENU_OPTIONS)
        throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
      const [row] = await tx
        .insert(menuOptions)
        .values({
          orgId: requireOrg(ctx),
          eventId: input.eventId,
          label: input.label,
          notes: input.notes,
          position: menu.length,
        })
        .returning({ id: menuOptions.id, label: menuOptions.label, notes: menuOptions.notes });
      if (!row) throw new DomainError('internal');
      return { ...row, renamed: 0 };
    }
    const before = menu.find((m) => m.id === input.optionId);
    if (!before) throw new DomainError('not_found', 'Menu option not found', { field: 'optionId' });
    await tx
      .update(menuOptions)
      .set({ label: input.label, notes: input.notes, updatedAt: ctx.now })
      .where(eq(menuOptions.id, before.id));
    let renamed = 0;
    if (before.label !== input.label) {
      const moved = await tx
        .update(guests)
        .set({ meal: input.label, updatedAt: ctx.now })
        .where(and(eq(guests.eventId, input.eventId), eq(guests.meal, before.label)))
        .returning({ id: guests.id, partyId: guests.partyId });
      renamed = moved.length;
      await recordHistoryTx(
        tx,
        ctx,
        moved.map((g) => ({
          eventId: input.eventId,
          partyId: g.partyId,
          guestId: g.id,
          action: 'guest_updated' as const,
          source: 'manual' as const,
          fields: ['meal'],
        })),
      );
    }
    return { id: before.id, label: input.label, notes: input.notes, renamed };
  },
  present: (r) => ({ id: r.id, label: r.label, notes: r.notes }),
  audit: (input, r) => ({
    action: input.optionId ? 'guests.menu.update' : 'guests.menu.add',
    targetType: 'menu_option',
    targetId: r?.id ?? null,
    data: { eventId: input.eventId, renamed: r?.renamed ?? 0 },
  }),
});

/** Remove a menu option nobody chose (`menu_option_in_use` otherwise). */
export const removeMenuOptionCommand = tenantCommand({
  name: 'guests.removeMenuOption',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), optionId: z.uuid() }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const [opt] = await tx
      .select()
      .from(menuOptions)
      .where(and(eq(menuOptions.id, input.optionId), eq(menuOptions.eventId, input.eventId)));
    if (!opt) throw new DomainError('not_found', 'Menu option not found', { field: 'optionId' });
    const [used] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(guests)
      .where(and(eq(guests.eventId, input.eventId), eq(guests.meal, opt.label)));
    if ((used?.n ?? 0) > 0)
      throw new DomainError('invalid_state', 'Guests chose this option', {
        reason: 'menu_option_in_use',
        count: used?.n ?? 0,
      });
    await tx.delete(menuOptions).where(eq(menuOptions.id, opt.id));
    // Keep positions 0…n-1.
    const rest = await tx
      .select({ id: menuOptions.id })
      .from(menuOptions)
      .where(eq(menuOptions.eventId, input.eventId))
      .orderBy(asc(menuOptions.position), asc(menuOptions.createdAt));
    for (const [position, r] of rest.entries())
      await tx.update(menuOptions).set({ position, updatedAt: ctx.now }).where(eq(menuOptions.id, r.id));
    return { removed: true };
  },
  audit: (input) => ({
    action: 'guests.menu.remove',
    targetType: 'menu_option',
    targetId: input.optionId,
    data: { eventId: input.eventId },
  }),
});

/* ----------------------------------------------------------------------------- questions ---- */

export const RsvpQuestionsDto = z.object({
  /** 0 until the questions were first published. */
  version: z.int(),
  definition: RsvpFormDefinitionSchema,
  menu: z.array(MenuOptionDto),
});
export type RsvpQuestionsDto = z.infer<typeof RsvpQuestionsDto>;

/** The event's questions (current version) and menu, for the host's builder. */
export const rsvpQuestionsQuery = tenantQuery({
  name: 'guests.rsvpQuestions',
  input: z.object({ eventId: z.uuid() }),
  output: RsvpQuestionsDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    const [f, menu] = await Promise.all([currentRsvpFormTx(tx, input.eventId), menuTx(tx, input.eventId)]);
    return { version: f?.version ?? 0, definition: f?.definition ?? { questions: [] }, menu };
  },
});

/**
 * Publish the event's RSVP questions as a new version (parties that already answered keep the
 * version they answered). Each question's sub-event must be one of the event's; a meal question
 * needs a menu. `expectedVersion` refuses a publish from a stale editor (`stale_version`).
 */
export const publishRsvpQuestionsCommand = tenantCommand({
  name: 'guests.publishRsvpQuestions',
  input: z.object({
    eventId: z.uuid(),
    definition: RsvpFormDefinitionSchema,
    expectedVersion: z.int().min(0).optional(),
  }),
  output: z.object({ version: z.int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOfTx(tx, input.eventId);
    const facts = await rsvpFactsTx(tx, input.eventId, []);
    const subs = new Set(facts.subs.map((s) => s.id));
    for (const [i, q] of input.definition.questions.entries())
      if (q.subEventId !== null && !subs.has(q.subEventId))
        throw new DomainError('validation_failed', 'Unknown sub-event', {
          reason: 'unknown_sub_event',
          field: `questions.${i}.subEventId`,
        });
    if (
      input.definition.questions.some((q) => q.type === 'meal') &&
      (await menuTx(tx, input.eventId)).length === 0
    )
      throw new DomainError('validation_failed', 'Add the menu first', {
        reason: 'menu_empty',
        field: 'questions',
      });
    const r = await publishRsvpFormTx(tx, ctx, input.eventId, input.definition, input.expectedVersion);
    return { version: r.version, formId: r.formId };
  },
  present: (r) => ({ version: r.version }),
  audit: (input, r) => ({
    action: 'guests.rsvp_questions.publish',
    targetType: 'form',
    targetId: r?.formId ?? null,
    data: {
      eventId: input.eventId,
      version: r?.version,
      questions: input.definition.questions.length,
      conditional: input.definition.questions.filter((q) => q.showIf !== null).length,
    },
  }),
});

/* --------------------------------------------------------------------- the party's page ---- */

/** A question as the party's page shows it (no write-back target: that is the host's business). */
const PublicQuestionDto = z.object({
  key: z.string(),
  type: z.enum(RSVP_FIELD_TYPES),
  label: z.string(),
  help: z.string().nullable(),
  required: z.boolean(),
  sensitive: z.boolean(),
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  min: z.int().nullable(),
  max: z.int().nullable(),
  subEventId: z.uuid().nullable(),
  showIf: z.unknown().nullable(),
});

export const PublicRsvpQuestionsDto = z.object({
  version: z.int(),
  questions: z.array(PublicQuestionDto),
  menu: z.array(MenuOptionDto),
  /** The party's invited guests: what the conditions read, and their own non-private answers. */
  guests: z.array(
    z.object({
      guestId: z.uuid(),
      ageClass: z.string(),
      isPlusOne: z.boolean(),
      hostGuestId: z.uuid().nullable(),
      named: z.boolean(),
      /** Earlier non-private answers (the meal as its menu option id). */
      values: z.record(z.string(), z.unknown()),
      /** Private questions they answered before: never shown back, kept when left blank. */
      kept: z.array(z.string()),
    }),
  ),
});
export type PublicRsvpQuestionsDto = z.infer<typeof PublicRsvpQuestionsDto>;

const mealIdOf = (menu: readonly MenuOptionDto[], meal: string | null) =>
  meal ? (menu.find((m) => m.label.toLocaleLowerCase() === meal.toLocaleLowerCase())?.id ?? null) : null;

/**
 * What the party's page needs to ask the questions: the questions (allowlisted), the menu with
 * its notes, and per invited guest of this party their context and earlier answers. Private
 * answers (dietary, accessibility, private questions) are never sent back, only which ones were
 * given. The caller resolved the party from its link (`publicRsvpQuery` rules).
 */
export async function publicRsvpQuestionsTx(
  tx: TenantTx,
  ctx: Ctx,
  at: { eventId: string; partyId: string },
): Promise<PublicRsvpQuestionsDto> {
  const f = await currentRsvpFormTx(tx, at.eventId);
  const empty = { version: f?.version ?? 0, questions: [], menu: [], guests: [] };
  if (!f || f.definition.questions.length === 0) return empty;
  const menu = await menuTx(tx, at.eventId);
  const all = await rsvpFactsTx(tx, at.eventId, [at.partyId]);
  const invitedIds = new Set([...all.invited.values()].flatMap((s) => [...s]));
  const mine = all.guestRows.filter((g) => invitedIds.has(g.id));
  const responses = await rsvpResponsesTx(
    tx,
    ctx,
    at.eventId,
    mine.map((g) => g.id),
    { secret: true },
  );
  const orgId = requireOrg(ctx);
  const sensitive = f.definition.questions.filter((q) => q.sensitive);
  const out = [];
  for (const g of mine) {
    const r = responses.get(g.id);
    const values: Record<string, unknown> = { ...(r?.answers ?? {}) };
    const meal = f.definition.questions.find((q) => q.type === 'meal');
    const mealId = mealIdOf(menu, g.meal);
    if (meal && mealId) values[meal.key] = mealId;
    const sealed = sensitive.some((q) => q.binding) ? await unseal(orgId, g.privateCiphertext) : null;
    const kept = sensitive
      .filter((q) => (q.binding ? !!sealed?.[q.binding] : r?.secret[q.key] !== undefined))
      .map((q) => q.key);
    out.push({
      guestId: g.id,
      ageClass: g.ageClass,
      isPlusOne: g.kind === 'plus_one',
      hostGuestId: g.hostGuestId,
      named: !!g.firstName,
      values,
      kept,
    });
  }
  return PublicRsvpQuestionsDto.parse({
    version: f.version,
    questions: f.definition.questions,
    menu,
    guests: out,
  });
}

/** A stable reason for each answer problem (the party's page localizes it). */
function answerReason(message: string): string {
  if (message === 'Not on your path') return 'hidden_answer';
  if (message === 'Required') return 'question_required';
  if (message === 'Unknown question') return 'unknown_question';
  if (message === 'Too long') return 'too_long';
  if (/^(Number expected|Whole number|At least|At most)/.test(message)) return 'number';
  if (/^Choose/.test(message)) return 'choose';
  return 'form_invalid';
}

export const QuestionAnswersInput = z
  .array(
    z.object({
      guestId: z.uuid(),
      answers: z.record(z.string().max(40), z.unknown()).refine((a) => Object.keys(a).length <= 50),
    }),
  )
  .max(20)
  .default([]);
export type QuestionAnswersInput = z.input<typeof QuestionAnswersInput>;

type GuestRow = typeof guests.$inferSelect;

/**
 * Apply the household's answers to the questions, in the RSVP submit's transaction, after its
 * statuses and plus-one names were written. For each invited, named guest of the party the
 * server recomputes which questions they see (their sub-events, attending as just answered, age,
 * plus-one) and checks every answer: required ones must be answered, and an answer to a question
 * they can't see is **rejected** (`hidden_answer`), never stored. Then: the meal goes to
 * `guests.meal` (the option's label), dietary and accessibility answers into the sealed private
 * fields, the other answers replace the guest's earlier response (private ones sealed). A private
 * answer left blank keeps the earlier one (the page never shows it back). History names the
 * changed fields only.
 */
export async function applyRsvpQuestionsTx(
  tx: TenantTx,
  ctx: Ctx,
  at: {
    eventId: string;
    partyId: string;
    statuses: readonly { guestId: string; subEventId: string; status: ResponseStatus }[];
    input: readonly { guestId: string; answers: Record<string, unknown> }[];
  },
): Promise<{ guests: number }> {
  const f = await currentRsvpFormTx(tx, at.eventId);
  const sent = at.input.filter((x) => Object.values(x.answers).some((v) => v !== '' && v !== null));
  if (!f || f.definition.questions.length === 0) {
    if (sent.length)
      throw new DomainError('validation_failed', 'This event asks no questions', {
        reason: 'unknown_question',
        field: 'questions',
      });
    return { guests: 0 };
  }
  const orgId = requireOrg(ctx);
  const def: RsvpFormDefinition = f.definition;
  const menu = await menuTx(tx, at.eventId);
  const all = await rsvpFactsTx(tx, at.eventId, [at.partyId]);
  const party = all.guestRows.filter((g) => g.partyId === at.partyId);
  const byId = new Map(party.map((g) => [g.id, g]));
  for (const x of at.input)
    if (!byId.has(x.guestId))
      throw new DomainError('not_found', 'Not a guest of this party', {
        reason: 'not_in_party',
        field: 'questions',
      });
  const inputOf = new Map(at.input.map((x) => [x.guestId, x.answers]));
  const responses = await rsvpResponsesTx(
    tx,
    ctx,
    at.eventId,
    party.map((g) => g.id),
    { secret: true },
  );
  const entries: { guestId: string; open: Record<string, unknown>; secret: Record<string, unknown> }[] = [];
  const history: { guestId: string; fields: string[] }[] = [];
  for (const g of party) {
    const invited = all.subs.filter((s) => all.invited.get(s.id)?.has(g.id)).map((s) => s.id);
    const context: RsvpGuestContext = {
      invited,
      attending: at.statuses
        .filter((s) => s.guestId === g.id && s.status === 'attending')
        .map((s) => s.subEventId),
      ageClass: g.ageClass,
      isPlusOne: g.kind === 'plus_one',
      named: !!g.firstName,
      plusOneNamed: party.some((p) => p.hostGuestId === g.id && !!p.firstName),
    };
    const earlier = responses.get(g.id);
    const sealed = await unseal(orgId, g.privateCiphertext);
    const keep = new Set(
      def.questions
        .filter((q) => q.sensitive)
        .filter((q) => (q.binding ? !!sealed[q.binding] : earlier?.secret[q.key] !== undefined))
        .map((q) => q.key),
    );
    let check: ReturnType<typeof checkRsvpAnswers>;
    try {
      check = checkRsvpAnswers(def, context, inputOf.get(g.id) ?? {}, { menu, keep });
    } catch (err) {
      if (err instanceof AnswerError)
        throw new DomainError('validation_failed', err.message, {
          reason: answerReason(err.message),
          field: 'questions',
          guestId: g.id,
          question: err.field,
        });
      throw err;
    }
    const visible = new Set(check.visible);
    const fields = await writeBackTx(tx, ctx, g, def, check.answers, sealed, menu);
    const open: Record<string, unknown> = {};
    const secret: Record<string, unknown> = {};
    for (const q of def.questions) {
      if (!visible.has(q.key) || q.type === 'meal' || q.binding) continue;
      const v = check.answers[q.key];
      if (q.sensitive) {
        if (v !== undefined) secret[q.key] = v;
        else if (earlier?.secret[q.key] !== undefined) secret[q.key] = earlier.secret[q.key];
      } else if (v !== undefined) open[q.key] = v;
    }
    const changed =
      JSON.stringify(open) !== JSON.stringify(earlier?.answers ?? {}) ||
      JSON.stringify(secret) !== JSON.stringify(earlier?.secret ?? {});
    if (changed) fields.push('rsvpAnswers');
    if (fields.length) history.push({ guestId: g.id, fields });
    if (changed || earlier?.version !== f.version) entries.push({ guestId: g.id, open, secret });
  }
  await replaceRsvpResponsesTx(tx, ctx, at.eventId, f.versionId, entries);
  await recordHistoryTx(
    tx,
    ctx,
    history.map((h) => ({
      eventId: at.eventId,
      partyId: at.partyId,
      guestId: h.guestId,
      action: 'guest_updated' as const,
      source: 'rsvp' as const,
      fields: h.fields,
    })),
  );
  return { guests: history.length };
}

/** Meal and sealed answers onto the guest row; returns the changed field names. */
async function writeBackTx(
  tx: TenantTx,
  ctx: Ctx,
  g: GuestRow,
  def: RsvpFormDefinition,
  answers: Record<string, unknown>,
  sealed: Awaited<ReturnType<typeof unseal>>,
  menu: readonly MenuOptionDto[],
): Promise<string[]> {
  const fields: string[] = [];
  const set: Partial<typeof guests.$inferInsert> = {};
  const meal = def.questions.find((q) => q.type === 'meal');
  const mealAnswer = meal ? answers[meal.key] : undefined;
  if (typeof mealAnswer === 'string') {
    const label = menu.find((m) => m.id === mealAnswer)?.label ?? null;
    if (label && label !== g.meal) {
      set.meal = label;
      fields.push('meal');
    }
  }
  const next = { ...sealed };
  for (const q of def.questions) {
    if (!q.binding) continue;
    const v = answers[q.key];
    if (typeof v === 'string' && v && v !== sealed[q.binding]) {
      next[q.binding] = v;
      fields.push(q.binding);
    }
  }
  if (fields.some((x) => x === 'dietary' || x === 'accessibility'))
    set.privateCiphertext = await seal(requireOrg(ctx), next);
  if (fields.length)
    await tx
      .update(guests)
      .set({ ...set, updatedAt: ctx.now })
      .where(eq(guests.id, g.id));
  return fields;
}

/* ----------------------------------------------------------------------------- meal counts ---- */

export const MealCountsDto = z.object({
  menu: z.array(MenuOptionDto),
  /** The meal question's sub-event (null: the whole event); null when there is no meal question. */
  mealQuestion: z.object({ key: z.string(), subEventId: z.uuid().nullable() }).nullable(),
  subEvents: z.array(
    z.object({
      subEventId: z.uuid(),
      name: z.string(),
      attending: z.int(),
      /** Attending guests per menu option, in menu order. */
      counts: z.array(z.object({ optionId: z.uuid(), count: z.int() })),
      /** Attending guests whose meal is not on the menu (typed by the host). */
      other: z.int(),
      /** Attending guests with no meal yet. */
      none: z.int(),
    }),
  ),
});
export type MealCountsDto = z.infer<typeof MealCountsDto>;

/**
 * Meal counts per sub-event: attending guests by meal (`guests.meal`), for the meal question's
 * sub-event, or every sub-event when it asks about the whole event or there is none. Counts only.
 */
export const mealCountsQuery = tenantQuery({
  name: 'guests.mealCounts',
  input: z.object({ eventId: z.uuid() }),
  output: MealCountsDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    const [f, menu, facts] = await Promise.all([
      currentRsvpFormTx(tx, input.eventId),
      menuTx(tx, input.eventId),
      rsvpFactsTx(tx, input.eventId, null),
    ]);
    const meal = f?.definition.questions.find((q) => q.type === 'meal') ?? null;
    const subs = facts.subs.filter((s) => !meal?.subEventId || s.id === meal.subEventId);
    const byGuest = new Map(facts.guestRows.map((g) => [g.id, g]));
    return {
      menu,
      mealQuestion: meal ? { key: meal.key, subEventId: meal.subEventId } : null,
      subEvents: subs.map((s) => {
        const counts = new Map(menu.map((m) => [m.id, 0]));
        let attending = 0;
        let other = 0;
        let none = 0;
        for (const id of facts.invited.get(s.id) ?? []) {
          if (facts.responses.get(s.id)?.get(id) !== 'attending') continue;
          attending++;
          const g = byGuest.get(id);
          const optionId = mealIdOf(menu, g?.meal ?? null);
          if (optionId) counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
          else if (g?.meal) other++;
          else none++;
        }
        return {
          subEventId: s.id,
          name: s.name,
          attending,
          counts: [...counts].map(([optionId, count]) => ({ optionId, count })),
          other,
          none,
        };
      }),
    };
  },
});

/* ---------------------------------------------------------------------------------- export ---- */

const Head = z.string().trim().min(1).max(60);

const ExportParams = z.object({
  headers: z.object({ party: Head, guest: Head, age: Head, meal: Head, dietary: Head, accessibility: Head }),
  statuses: z.object({ attending: Head, declined: Head, awaiting: Head, notInvited: Head }),
  ages: z.object({ adult: Head, child: Head, infant: Head }),
  yes: Head,
  no: Head,
});
type ExportParams = z.infer<typeof ExportParams>;

/** One answer as a cell: choice labels (from the newest version that has the question), yes/no. */
function answerCell(
  q: Pick<RsvpQuestion, 'type' | 'options'>,
  v: unknown,
  params: ExportParams,
  menu: readonly MenuOptionDto[],
): string {
  if (v === undefined || v === null) return '';
  const label = (x: unknown) => q.options.find((o) => o.value === x)?.label ?? String(x);
  if (q.type === 'checkbox') return v === true ? params.yes : params.no;
  if (q.type === 'select') return label(v);
  if (q.type === 'multi_select') return Array.isArray(v) ? v.map(label).join('; ') : label(v);
  if (q.type === 'meal') return menu.find((m) => m.id === v)?.label ?? String(v);
  return String(v);
}

/**
 * The guests' answers as CSV, one row per guest (party, name, age, status per sub-event, meal,
 * then one column per question of any version that was answered). The base export leaves every
 * private column out (private questions, dietary, accessibility); the private one, for roles
 * holding `attendees:export_private`, adds them. Both are exports: step-up, audited start
 * (`bulk.start`, counts only), refused while staff act as a member.
 */
function rsvpAnswersExport(key: string, permission: string, withPrivate: boolean) {
  return defineBulkAction({
    key,
    entitlement: 'guests',
    permission,
    params: ExportParams,
    filter: z.object({}),
    chunkSize: 500,
    file: {
      contentType: 'text/csv; charset=utf-8',
      name: (_p, now) => `rsvp-answers-${now.toISOString().slice(0, 10)}.csv`,
    },
    auditParams: () => ({ private: withPrivate }),
    resolve: async (tx, sel) => {
      if (!sel.eventId) throw new DomainError('validation_failed', 'An event is required');
      await eventOfTx(tx, sel.eventId);
      const rows = await tx
        .select({ id: guests.id })
        .from(guests)
        .innerJoin(parties, eq(parties.id, guests.partyId))
        .where(and(eq(guests.eventId, sel.eventId), sel.ids ? inArray(guests.id, [...sel.ids]) : undefined))
        .orderBy(sql`lower(${parties.name})`, asc(parties.id), asc(guests.createdAt), asc(guests.id));
      return rows.map((r) => r.id);
    },
    run: async (tx, ctx, ids, params, meta) => {
      if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
      const eventId = meta.eventId;
      const orgId = requireOrg(ctx);
      const [versions, menu, facts] = await Promise.all([
        rsvpFormVersionsTx(tx, eventId),
        menuTx(tx, eventId),
        rsvpFactsTx(tx, eventId, null),
      ]);
      const responses = await rsvpResponsesTx(tx, ctx, eventId, ids, { secret: withPrivate });
      // Questions of the current version first, then ones only older versions had (if answered).
      const answered = new Set(
        [...responses.values()].flatMap((r) => [...Object.keys(r.answers), ...Object.keys(r.secret)]),
      );
      const questions: RsvpQuestion[] = [];
      const seen = new Set<string>();
      for (const [i, v] of versions.entries())
        for (const q of v.definition.questions) {
          if (seen.has(q.key) || q.type === 'meal' || q.binding) continue;
          if (q.sensitive && !withPrivate) continue;
          if (i > 0 && !answered.has(q.key)) continue;
          seen.add(q.key);
          questions.push(q);
        }
      const partyName = new Map(
        (
          await tx
            .select({ id: parties.id, name: parties.name })
            .from(parties)
            .where(eq(parties.eventId, eventId))
        ).map((p) => [p.id, p.name]),
      );
      const byId = new Map(facts.guestRows.map((g) => [g.id, g]));
      let out = meta.first
        ? `﻿${csvRow([
            params.headers.party,
            params.headers.guest,
            params.headers.age,
            ...facts.subs.map((s) => s.name),
            params.headers.meal,
            ...questions.map((q) => q.label),
            ...(withPrivate ? [params.headers.dietary, params.headers.accessibility] : []),
          ])}`
        : '';
      const results = [];
      for (const id of ids) {
        const g = byId.get(id);
        if (!g) {
          results.push({ id, ok: false, code: 'not_found' });
          continue;
        }
        const host = g.hostGuestId ? byId.get(g.hostGuestId) : undefined;
        const name =
          [g.firstName, g.lastName].filter(Boolean).join(' ') ||
          (host ? `+1 ${[host.firstName, host.lastName].filter(Boolean).join(' ')}` : '');
        const r = responses.get(id);
        const answers = { ...(r?.answers ?? {}), ...(r?.secret ?? {}) };
        const sealed = withPrivate ? await unseal(orgId, g.privateCiphertext) : null;
        out += csvRow([
          partyName.get(g.partyId) ?? '',
          name,
          params.ages[g.ageClass as keyof ExportParams['ages']] ?? g.ageClass,
          ...facts.subs.map((s) => {
            if (!facts.invited.get(s.id)?.has(id)) return params.statuses.notInvited;
            const status = facts.responses.get(s.id)?.get(id);
            return params.statuses[status ?? 'awaiting'];
          }),
          g.meal ?? '',
          ...questions.map((q) => answerCell(q, answers[q.key], params, menu)),
          ...(withPrivate ? [sealed?.dietary ?? '', sealed?.accessibility ?? ''] : []),
        ]);
        results.push({ id, ok: true });
      }
      return { results, append: out };
    },
  });
}

export const rsvpAnswersExportAction = rsvpAnswersExport('guests.rsvpAnswersCsv', 'attendees:export', false);
export const rsvpAnswersPrivateExportAction = rsvpAnswersExport(
  'guests.rsvpAnswersPrivateCsv',
  'attendees:export_private',
  true,
);
export const rsvpAnswersExportBulk = bulkCommands(rsvpAnswersExportAction);
export const rsvpAnswersPrivateExportBulk = bulkCommands(rsvpAnswersPrivateExportAction);
