import { z } from 'zod';

/** Question types for checkout questions (and every form). */
export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'count',
  'select',
  'multi_select',
  'checkbox',
] as const;
/**
 * Survey forms (M3.9a) add two scales: `rating` (1–5) and `nps` (0–10, "How likely are you to
 * recommend…"). Checkout questions refuse them (`publishFormTx`).
 */
export const SURVEY_FIELD_TYPES = [...FIELD_TYPES, 'rating', 'nps'] as const;
export type FieldType = (typeof SURVEY_FIELD_TYPES)[number];
export const RATING_MAX = 5;
export const NPS_MAX = 10;

/**
 * A condition in a safe JsonLogic subset: `{"var": key}`, literals, `==`, `!=`, `>`, `>=`, `<`,
 * `<=`, `in`, `and`, `or`, `!`. Anything else is rejected when the form is saved, so answers are
 * never evaluated against an unknown operator.
 */
export type Logic = string | number | boolean | null | readonly Logic[] | { readonly [op: string]: Logic };

const OPERATORS = new Set(['var', '==', '!=', '>', '>=', '<', '<=', 'in', 'and', 'or', '!']);

export function validLogic(l: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (l === null || ['string', 'number', 'boolean'].includes(typeof l)) return true;
  if (Array.isArray(l)) return l.length <= 50 && l.every((x) => validLogic(x, depth + 1));
  if (typeof l !== 'object') return false;
  const keys = Object.keys(l);
  if (keys.length !== 1 || !OPERATORS.has(keys[0] as string)) return false;
  const arg = (l as Record<string, unknown>)[keys[0] as string];
  if (keys[0] === 'var') return typeof arg === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(arg);
  return validLogic(arg, depth + 1);
}

type Answers = Readonly<Record<string, unknown>>;

/** Evaluate a validated condition against the answers given so far. */
export function evaluate(l: Logic, answers: Answers): unknown {
  if (l === null || typeof l !== 'object') return l;
  if (Array.isArray(l)) return l.map((x) => evaluate(x as Logic, answers));
  const [op, raw] = Object.entries(l)[0] as [string, Logic | Logic[]];
  if (op === 'var') return answers[raw as string] ?? null;
  const args = (Array.isArray(raw) ? raw : [raw]).map((x) => evaluate(x as Logic, answers));
  const [a, b] = args;
  switch (op) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '>':
      return Number(a) > Number(b);
    case '>=':
      return Number(a) >= Number(b);
    case '<':
      return Number(a) < Number(b);
    case '<=':
      return Number(a) <= Number(b);
    case 'in':
      return Array.isArray(b)
        ? b.includes(a)
        : typeof b === 'string' && typeof a === 'string' && b.includes(a);
    case 'and':
      return args.every(Boolean);
    case 'or':
      return args.some(Boolean);
    case '!':
      return !a;
    default:
      return false;
  }
}

export const FieldKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Keys are lower-case letters, digits and _');
export const Option = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
});

export const FieldDefinition = z
  .object({
    key: FieldKey,
    type: z.enum(SURVEY_FIELD_TYPES),
    label: z.string().trim().min(1).max(200),
    help: z.string().trim().max(300).nullable().default(null),
    required: z.boolean().default(false),
    /** Stored envelope-encrypted and never exported in bulk (roadmap: sensitive answers). */
    sensitive: z.boolean().default(false),
    options: z.array(Option).max(50).default([]),
    min: z.int().nullable().default(null),
    max: z.int().nullable().default(null),
    showIf: z.unknown().refine(validLogic, 'Unsupported condition').nullable().default(null),
  })
  .superRefine((f, c) => {
    const choice = f.type === 'select' || f.type === 'multi_select';
    if (choice && f.options.length < 1)
      c.addIssue({ code: 'custom', message: 'Add at least one option', path: ['options'] });
    if (!choice && f.options.length > 0)
      c.addIssue({ code: 'custom', message: 'Only choice fields have options', path: ['options'] });
    if ((f.type === 'rating' || f.type === 'nps') && (f.min !== null || f.max !== null))
      c.addIssue({ code: 'custom', message: 'Scales have a fixed range', path: ['max'] });
    if (f.min !== null && f.max !== null && f.max < f.min)
      c.addIssue({ code: 'custom', message: 'max must be ≥ min', path: ['max'] });
    if (new Set(f.options.map((o) => o.value)).size !== f.options.length)
      c.addIssue({ code: 'custom', message: 'Option values must be unique', path: ['options'] });
  });
export type FieldDefinition = z.output<typeof FieldDefinition>;

export const FormDefinition = z
  .object({ fields: z.array(FieldDefinition).max(50) })
  .refine((d) => new Set(d.fields.map((f) => f.key)).size === d.fields.length, {
    message: 'Field keys must be unique',
    path: ['fields'],
  });
export type FormDefinition = z.output<typeof FormDefinition>;

export class AnswerError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

/**
 * Validate and normalize answers against a definition. Hidden fields (their `showIf` is false)
 * are dropped; unknown keys are rejected. Returns only the answers that should be stored.
 */
export function checkAnswers(def: FormDefinition, input: Answers): Record<string, unknown> {
  const known = new Set(def.fields.map((f) => f.key));
  for (const k of Object.keys(input)) if (!known.has(k)) throw new AnswerError(k, 'Unknown question');
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    // Conditions see the answers already accepted (earlier fields), so order matters.
    if (f.showIf !== null && !evaluate(f.showIf as Logic, out)) continue;
    const raw = input[f.key];
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (empty) {
      if (f.required) throw new AnswerError(f.key, 'Required');
      continue;
    }
    out[f.key] = normalize(f, raw);
  }
  return out;
}

/** One answer, normalized for its question's type (shared with the registration kind). */
export function normalize(f: FieldDefinition, raw: unknown): unknown {
  const bad = (m: string) => new AnswerError(f.key, m);
  switch (f.type) {
    case 'short_text':
    case 'long_text': {
      if (typeof raw !== 'string') throw bad('Text expected');
      const v = raw.trim();
      if (v.length > (f.type === 'short_text' ? 200 : 2000)) throw bad('Too long');
      return v;
    }
    case 'number':
    case 'count': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) throw bad('Number expected');
      if (f.type === 'count' && (!Number.isInteger(n) || n < 0)) throw bad('Whole number ≥ 0 expected');
      if (f.min !== null && n < f.min) throw bad(`At least ${f.min}`);
      if (f.max !== null && n > f.max) throw bad(`At most ${f.max}`);
      return n;
    }
    case 'select': {
      if (typeof raw !== 'string' || !f.options.some((o) => o.value === raw)) throw bad('Choose an option');
      return raw;
    }
    case 'multi_select': {
      const vals = Array.isArray(raw) ? raw : [raw];
      if (!vals.every((v) => typeof v === 'string' && f.options.some((o) => o.value === v)))
        throw bad('Choose from the options');
      return [...new Set(vals as string[])];
    }
    case 'rating':
    case 'nps': {
      const top = f.type === 'rating' ? RATING_MAX : NPS_MAX;
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isInteger(n) || n < (f.type === 'rating' ? 1 : 0) || n > top) throw bad('Choose a score');
      return n;
    }
    case 'checkbox': {
      if (raw === true || raw === 'true' || raw === 'on' || raw === '1') return true;
      if (raw === false || raw === 'false' || raw === '0') {
        if (f.required) throw bad('Required');
        return false;
      }
      throw bad('Checkbox expected');
    }
  }
}
