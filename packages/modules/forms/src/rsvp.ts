import { z } from 'zod';
import {
  AnswerError,
  evaluate,
  FIELD_TYPES,
  type FieldDefinition,
  FieldKey,
  type Logic,
  normalize,
  Option,
  validLogic,
} from './definition.ts';
import { isEmptyAnswer, logicVars } from './registration.ts';

/**
 * The `rsvp` form kind (M4.1e): questions a host asks each guest of a household on the RSVP page,
 * for the whole event or for one sub-event ("Reception: meal choice"). Pure and client-safe: the
 * party's browser, the host's live preview and the server decide which questions a guest sees
 * with the same function (`rsvpVisible`), and the server is the authority (`checkRsvpAnswers`).
 */
export const RSVP_FORM_KIND = 'rsvp' as const;

/**
 * RSVP questions: the checkout types plus `meal`, a choice among the event's menu options (the
 * menu is the guests module's; the definition holds no options). The answer is written back to
 * the guest's meal.
 */
export const RSVP_FIELD_TYPES = [...FIELD_TYPES, 'meal'] as const;
export type RsvpFieldType = (typeof RSVP_FIELD_TYPES)[number];

/**
 * Where a text answer is written back to the guest (P4-3: both are sealed with the guest's other
 * private answers). A bound question is always private.
 */
export const RSVP_BINDINGS = ['dietary', 'accessibility'] as const;
export type RsvpBinding = (typeof RSVP_BINDINGS)[number];
/** The longest dietary or accessibility answer the guest record keeps. */
export const RSVP_BOUND_MAX = 500;

/**
 * What a condition may read besides earlier answers of the same guest:
 * - `attending`: the guest is attending the question's sub-event (any sub-event, for a question
 *   about the whole event), as chosen on the same page;
 * - `age_class`: `adult`, `child` or `infant`;
 * - `is_plus_one`: the guest is someone's plus-one;
 * - `plus_one_named`: the guest brings a plus-one who has a name (given on the same page or before).
 */
export const RSVP_CONTEXT_VARS = ['attending', 'age_class', 'is_plus_one', 'plus_one_named'] as const;
export type RsvpContextVar = (typeof RSVP_CONTEXT_VARS)[number];

export const MAX_RSVP_QUESTIONS = 50;

export const RsvpQuestion = z
  .object({
    key: FieldKey,
    type: z.enum(RSVP_FIELD_TYPES),
    label: z.string().trim().min(1).max(200),
    help: z.string().trim().max(300).nullable().default(null),
    required: z.boolean().default(false),
    /** Stored sealed and never shown back on the RSVP page; exported only to allowed roles. */
    sensitive: z.boolean().default(false),
    options: z.array(Option).max(50).default([]),
    min: z.int().nullable().default(null),
    max: z.int().nullable().default(null),
    /** The sub-event the question is about; null: the whole event. */
    subEventId: z.uuid().nullable().default(null),
    binding: z.enum(RSVP_BINDINGS).nullable().default(null),
    showIf: z.unknown().refine(validLogic, 'Unsupported condition').nullable().default(null),
  })
  .superRefine((f, c) => {
    const choice = f.type === 'select' || f.type === 'multi_select';
    if (choice && f.options.length < 1)
      c.addIssue({ code: 'custom', message: 'Add at least one option', path: ['options'] });
    if (!choice && f.options.length > 0)
      c.addIssue({ code: 'custom', message: 'Only choice fields have options', path: ['options'] });
    if (new Set(f.options.map((o) => o.value)).size !== f.options.length)
      c.addIssue({ code: 'custom', message: 'Option values must be unique', path: ['options'] });
    if (f.min !== null && f.max !== null && f.max < f.min)
      c.addIssue({ code: 'custom', message: 'max must be ≥ min', path: ['max'] });
    if (f.type === 'meal' && (f.min !== null || f.max !== null))
      c.addIssue({ code: 'custom', message: 'Only numbers have a range', path: ['max'] });
    if ((RSVP_CONTEXT_VARS as readonly string[]).includes(f.key))
      c.addIssue({ code: 'custom', message: 'This key is reserved', path: ['key'] });
    if (f.binding) {
      if (f.type !== 'short_text' && f.type !== 'long_text')
        c.addIssue({ code: 'custom', message: 'Only text answers can be saved there', path: ['binding'] });
      // Dietary and accessibility answers are sealed (P4-3).
      if (!f.sensitive)
        c.addIssue({ code: 'custom', message: 'Saved answers are private', path: ['sensitive'] });
    }
    if (f.type === 'meal' && f.sensitive)
      c.addIssue({ code: 'custom', message: 'The meal choice is not private', path: ['sensitive'] });
  });
export type RsvpQuestion = z.output<typeof RsvpQuestion>;
export type RsvpQuestionInput = z.input<typeof RsvpQuestion>;

export const RsvpFormDefinition = z
  .object({ questions: z.array(RsvpQuestion).max(MAX_RSVP_QUESTIONS) })
  .superRefine((d, c) => {
    const keys = d.questions.map((q) => q.key);
    if (new Set(keys).size !== keys.length)
      c.addIssue({ code: 'custom', message: 'Field keys must be unique', path: ['questions'] });
    // One meal per guest (`guests.meal`), and one question per write-back.
    if (d.questions.filter((q) => q.type === 'meal').length > 1)
      c.addIssue({ code: 'custom', message: 'Only one meal question', path: ['questions'] });
    for (const b of RSVP_BINDINGS)
      if (d.questions.filter((q) => q.binding === b).length > 1)
        c.addIssue({ code: 'custom', message: 'Only one question per saved answer', path: ['questions'] });
    // Conditions read the guest's context or answers to earlier questions.
    const before = new Set<string>(RSVP_CONTEXT_VARS);
    for (const [i, q] of d.questions.entries()) {
      for (const v of logicVars(q.showIf))
        if (!before.has(v))
          c.addIssue({
            code: 'custom',
            message: 'A condition can only use earlier questions',
            path: ['questions', i, 'showIf'],
          });
      before.add(q.key);
    }
  });
export type RsvpFormDefinition = z.output<typeof RsvpFormDefinition>;

/** One guest as the questions see them. */
export interface RsvpGuestContext {
  /** Sub-events the guest is invited to. */
  readonly invited: readonly string[];
  /** Sub-events the guest is attending (as chosen on the page). */
  readonly attending: readonly string[];
  readonly ageClass: string;
  readonly isPlusOne: boolean;
  /** A plus-one without a name yet gets no questions (they are a placeholder). */
  readonly named: boolean;
  readonly plusOneNamed: boolean;
}

/** A menu option as a meal question offers it (the guests module's menu). */
export interface RsvpMenuOption {
  readonly id: string;
  readonly label: string;
}

type Answers = Readonly<Record<string, unknown>>;

function contextFor(q: RsvpQuestion, g: RsvpGuestContext): Record<RsvpContextVar, unknown> {
  return {
    attending: q.subEventId === null ? g.attending.length > 0 : g.attending.includes(q.subEventId),
    age_class: g.ageClass,
    is_plus_one: g.isPlusOne,
    plus_one_named: g.plusOneNamed,
  };
}

/**
 * The questions a guest sees, in order: those about the whole event (for a guest invited to
 * anything) or about a sub-event they are invited to, whose condition holds for the guest's
 * context and their answers to earlier questions. A meal question needs a menu. Unnamed plus-ones
 * see nothing. `answers` are the guest's own (typed in the browser, normalized on the server).
 */
export function rsvpVisible(
  def: RsvpFormDefinition,
  guest: RsvpGuestContext,
  answers: Answers,
  opts: { menu: readonly RsvpMenuOption[] },
): RsvpQuestion[] {
  if (!guest.named || guest.invited.length === 0) return [];
  const seen: Record<string, unknown> = {};
  const out: RsvpQuestion[] = [];
  for (const q of def.questions) {
    if (q.subEventId !== null && !guest.invited.includes(q.subEventId)) continue;
    if (q.type === 'meal' && opts.menu.length === 0) continue;
    if (q.showIf !== null && !evaluate(q.showIf as Logic, { ...seen, ...contextFor(q, guest) })) continue;
    out.push(q);
    const v = answers[q.key];
    if (!isEmptyAnswer(v)) seen[q.key] = v;
  }
  return out;
}

/** One answer, normalized for its question (a meal must be one of the menu's options). */
export function normalizeRsvp(q: RsvpQuestion, raw: unknown, menu: readonly RsvpMenuOption[]): unknown {
  if (q.type === 'meal') {
    if (typeof raw !== 'string' || !menu.some((m) => m.id === raw))
      throw new AnswerError(q.key, 'Choose an option');
    return raw;
  }
  const v = normalize(q as unknown as FieldDefinition, raw);
  if (q.binding && typeof v === 'string' && v.length > RSVP_BOUND_MAX)
    throw new AnswerError(q.key, 'Too long');
  return v;
}

export interface RsvpCheck {
  /** The normalized answers to the questions the guest sees (blank ones left out). */
  readonly answers: Record<string, unknown>;
  /** Keys of the questions the guest sees. */
  readonly visible: readonly string[];
}

/**
 * Server authority for one guest: recompute which questions they see from their context and
 * answers, validate and normalize each answer, enforce required questions, and **reject** an
 * answer to a question they cannot see (unknown, another sub-event's, or behind a false
 * condition; `Not on your path`). A blank or unchecked answer to a hidden question is harmless
 * and ignored. `keep` lists private questions whose earlier answer stands when left blank (the
 * page never shows a private answer back), so they are not required again.
 */
export function checkRsvpAnswers(
  def: RsvpFormDefinition,
  guest: RsvpGuestContext,
  input: Answers,
  opts: { menu: readonly RsvpMenuOption[]; keep?: ReadonlySet<string> },
): RsvpCheck {
  const known = new Set(def.questions.map((q) => q.key));
  for (const k of Object.keys(input)) if (!known.has(k)) throw new AnswerError(k, 'Unknown question');
  const normalized: Record<string, unknown> = {};
  for (const q of def.questions) {
    const raw = input[q.key];
    if (isEmptyAnswer(raw)) continue;
    try {
      normalized[q.key] = normalizeRsvp(q, raw, opts.menu);
    } catch (err) {
      // An unusable answer to a hidden question is reported as hidden, not as malformed.
      normalized[q.key] = err;
    }
  }
  const clean = Object.fromEntries(Object.entries(normalized).filter(([, v]) => !(v instanceof Error)));
  const visible = rsvpVisible(def, guest, clean, opts);
  const on = new Set(visible.map((q) => q.key));
  for (const [k, v] of Object.entries(input)) {
    if (on.has(k) || isEmptyAnswer(v) || v === false || v === 'false') continue;
    throw new AnswerError(k, 'Not on your path');
  }
  const answers: Record<string, unknown> = {};
  for (const q of visible) {
    const v = normalized[q.key];
    if (v instanceof Error) throw v;
    if (v === undefined) {
      if (q.required && !opts.keep?.has(q.key)) throw new AnswerError(q.key, 'Required');
      continue;
    }
    answers[q.key] = v;
  }
  return { answers, visible: visible.map((q) => q.key) };
}

/* ------------------------------------------------------------------ the builder's conditions ---- */

/**
 * The conditions the host's question builder offers, as one rule (all parts must hold). The
 * builder writes it as JsonLogic (`ruleToLogic`) and reads it back (`ruleFromLogic`); a condition
 * written another way (the API) is shown as "custom" and kept as is.
 */
export interface RsvpRule {
  readonly attending: boolean;
  readonly adultsOnly: boolean;
  readonly plusOneNamed: boolean;
  /** An earlier question's answer: a choice, a checked box, or one of a multi-choice's options. */
  readonly answer: { readonly key: string; readonly value: string } | null;
}

export const EMPTY_RULE: RsvpRule = {
  attending: false,
  adultsOnly: false,
  plusOneNamed: false,
  answer: null,
};

const IS_ATTENDING = { '==': [{ var: 'attending' }, true] };
const IS_ADULT = { '==': [{ var: 'age_class' }, 'adult'] };
const PLUS_ONE_NAMED = { '==': [{ var: 'plus_one_named' }, true] };

/** The rule as a condition (null when it has no part). `questions`: the earlier ones, for types. */
export function ruleToLogic(rule: RsvpRule, questions: readonly Pick<RsvpQuestion, 'key' | 'type'>[]): Logic {
  const parts: Logic[] = [];
  if (rule.attending) parts.push(IS_ATTENDING);
  if (rule.adultsOnly) parts.push(IS_ADULT);
  if (rule.plusOneNamed) parts.push(PLUS_ONE_NAMED);
  if (rule.answer) {
    const q = questions.find((x) => x.key === rule.answer?.key);
    if (q?.type === 'checkbox') parts.push({ '==': [{ var: q.key }, true] });
    else if (q?.type === 'multi_select') parts.push({ in: [rule.answer.value, { var: q.key }] });
    else if (q) parts.push({ '==': [{ var: q.key }, rule.answer.value] });
  }
  if (parts.length === 0) return null;
  return parts.length === 1 ? (parts[0] as Logic) : { and: parts };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The builder's rule for a condition, or null when it was written some other way. */
export function ruleFromLogic(logic: unknown): RsvpRule | null {
  if (logic === null || logic === undefined) return EMPTY_RULE;
  const parts =
    typeof logic === 'object' && !Array.isArray(logic) && 'and' in (logic as object)
      ? (logic as { and: unknown }).and
      : [logic];
  if (!Array.isArray(parts) || parts.length === 0) return null;
  let rule: { -readonly [K in keyof RsvpRule]: RsvpRule[K] } = { ...EMPTY_RULE };
  for (const p of parts) {
    if (same(p, IS_ATTENDING) && !rule.attending) rule.attending = true;
    else if (same(p, IS_ADULT) && !rule.adultsOnly) rule.adultsOnly = true;
    else if (same(p, PLUS_ONE_NAMED) && !rule.plusOneNamed) rule.plusOneNamed = true;
    else {
      const answer = answerPart(p);
      if (!answer || rule.answer) return null;
      rule = { ...rule, answer };
    }
  }
  return rule;
}

function answerPart(p: unknown): RsvpRule['answer'] {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
  const [op, args] = Object.entries(p)[0] ?? [];
  if (!Array.isArray(args) || args.length !== 2) return null;
  const varOf = (x: unknown) =>
    typeof x === 'object' && x !== null && 'var' in x && typeof (x as { var: unknown }).var === 'string'
      ? (x as { var: string }).var
      : null;
  if (op === '==') {
    const key = varOf(args[0]);
    if (!key || (RSVP_CONTEXT_VARS as readonly string[]).includes(key)) return null;
    if (args[1] === true) return { key, value: 'true' };
    return typeof args[1] === 'string' ? { key, value: args[1] } : null;
  }
  if (op === 'in') {
    const key = varOf(args[1]);
    return key && typeof args[0] === 'string' ? { key, value: args[0] } : null;
  }
  return null;
}
