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

/**
 * The `registration` form kind (M5.1b): ordered pages, each with questions and an optional page
 * condition; pages and questions can be limited to registration types. Pure and client-safe: the
 * respondent's browser and the server compute the same path from the same definition.
 */
export const REGISTRATION_FORM_KIND = 'registration' as const;

/**
 * Registration questions: the checkout types plus `company` (free text with suggestions from the
 * org's known companies), `job_title` (the org's list plus "other", free text) and `consent` (a
 * checkbox bound to a versioned consent term of the crm ledger; unchecked by default, never
 * required).
 */
export const REGISTRATION_FIELD_TYPES = [...FIELD_TYPES, 'company', 'job_title', 'consent'] as const;
export type RegistrationFieldType = (typeof REGISTRATION_FIELD_TYPES)[number];

export const MAX_PAGES = 20;
export const MAX_REGISTRATION_FIELDS = 100;
export const COMPANY_MAX = 200;
export const JOB_TITLE_MAX = 120;

/**
 * A registration type id as the caller supplies it in the evaluation context (M5.1a's types plug
 * in here with no forms change): opaque to this module, a uuid in practice.
 */
export const RegistrationTypeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Unknown registration type');

/** `null`: every registration type. Otherwise only these (at least one). */
const TypeList = z
  .array(RegistrationTypeId)
  .min(1)
  .max(50)
  .refine((l) => new Set(l).size === l.length, 'Registration types must be unique')
  .nullable()
  .default(null);

/** A consent term of the crm ledger (`CONSENT_TERMS`) at the version the checkbox shows. */
export const ConsentBinding = z.object({
  term: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  version: z.int().min(1).max(10_000),
});
export type ConsentBinding = z.output<typeof ConsentBinding>;

const Condition = z.unknown().refine(validLogic, 'Unsupported condition').nullable().default(null);

export const RegistrationField = z
  .object({
    key: FieldKey,
    type: z.enum(REGISTRATION_FIELD_TYPES),
    label: z.string().trim().min(1).max(200),
    help: z.string().trim().max(300).nullable().default(null),
    required: z.boolean().default(false),
    sensitive: z.boolean().default(false),
    options: z.array(Option).max(50).default([]),
    min: z.int().nullable().default(null),
    max: z.int().nullable().default(null),
    showIf: Condition,
    registrationTypes: TypeList,
    consent: ConsentBinding.nullable().default(null),
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
    const added = f.type === 'company' || f.type === 'job_title' || f.type === 'consent';
    if (added && (f.min !== null || f.max !== null))
      c.addIssue({ code: 'custom', message: 'Only numbers have a range', path: ['max'] });
    if (f.type === 'consent') {
      if (!f.consent) c.addIssue({ code: 'custom', message: 'Choose a consent term', path: ['consent'] });
      // Consent is freely given: never required, never pre-checked, never hidden in the envelope.
      if (f.required)
        c.addIssue({ code: 'custom', message: 'Consent cannot be required', path: ['required'] });
      if (f.sensitive)
        c.addIssue({ code: 'custom', message: 'Consent cannot be private', path: ['sensitive'] });
    } else if (f.consent) {
      c.addIssue({ code: 'custom', message: 'Only consent questions have a term', path: ['consent'] });
    }
  });
export type RegistrationField = z.output<typeof RegistrationField>;

export const RegistrationPage = z.object({
  key: FieldKey,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().default(null),
  showIf: Condition,
  registrationTypes: TypeList,
  fields: z.array(RegistrationField).max(50),
});
export type RegistrationPage = z.output<typeof RegistrationPage>;

/** Every `{"var": key}` a condition reads. */
export function logicVars(l: unknown, out: string[] = []): string[] {
  if (l === null || typeof l !== 'object') return out;
  if (Array.isArray(l)) {
    for (const x of l) logicVars(x, out);
    return out;
  }
  for (const [op, arg] of Object.entries(l as Record<string, unknown>)) {
    if (op === 'var' && typeof arg === 'string') out.push(arg);
    else logicVars(arg, out);
  }
  return out;
}

export const RegistrationFormDefinition = z
  .object({ pages: z.array(RegistrationPage).min(1).max(MAX_PAGES) })
  .superRefine((d, c) => {
    const pageKeys = d.pages.map((p) => p.key);
    if (new Set(pageKeys).size !== pageKeys.length)
      c.addIssue({ code: 'custom', message: 'Page keys must be unique', path: ['pages'] });
    const all = d.pages.flatMap((p) => p.fields.map((f) => f.key));
    if (new Set(all).size !== all.length)
      c.addIssue({ code: 'custom', message: 'Field keys must be unique', path: ['pages'] });
    if (all.length > MAX_REGISTRATION_FIELDS)
      c.addIssue({ code: 'custom', message: 'Too many questions', path: ['pages'] });
    // Conditions read answers given before them: earlier pages, or earlier on the same page.
    const before = new Set<string>();
    for (const [i, p] of d.pages.entries()) {
      for (const v of logicVars(p.showIf))
        if (!before.has(v))
          c.addIssue({
            code: 'custom',
            message: 'A condition can only use earlier questions',
            path: ['pages', i, 'showIf'],
          });
      for (const [j, f] of p.fields.entries()) {
        for (const v of logicVars(f.showIf))
          if (!before.has(v))
            c.addIssue({
              code: 'custom',
              message: 'A condition can only use earlier questions',
              path: ['pages', i, 'fields', j, 'showIf'],
            });
        before.add(f.key);
      }
    }
  });
export type RegistrationFormDefinition = z.output<typeof RegistrationFormDefinition>;

type Answers = Readonly<Record<string, unknown>>;

/** No answer: what an untouched input posts. */
export const isEmptyAnswer = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
/** Nothing said: empty, or an unchecked box (which a hidden question may harmlessly post). */
const isBlank = (v: unknown) => isEmptyAnswer(v) || v === false;

export const typeAllows = (list: readonly string[] | null, typeId: string) =>
  list === null || list.includes(typeId);

export interface PathPage {
  readonly page: RegistrationPage;
  /** The page's questions this respondent sees, in order. */
  readonly fields: readonly RegistrationField[];
}

/**
 * The respondent's path: the pages (and questions) their registration type and their answers so
 * far lead to. A condition sees only answers to questions already on the path, in order; a page
 * with no visible question is skipped. The browser runs this on typed answers, the server on the
 * normalized ones (`checkRegistrationAnswers`), and both agree (property test).
 */
export function computePath(def: RegistrationFormDefinition, typeId: string, answers: Answers): PathPage[] {
  const seen: Record<string, unknown> = {};
  const path: PathPage[] = [];
  for (const page of def.pages) {
    if (!typeAllows(page.registrationTypes, typeId)) continue;
    if (page.showIf !== null && !evaluate(page.showIf as Logic, seen)) continue;
    const fields: RegistrationField[] = [];
    for (const f of page.fields) {
      if (!typeAllows(f.registrationTypes, typeId)) continue;
      if (f.showIf !== null && !evaluate(f.showIf as Logic, seen)) continue;
      fields.push(f);
      const v = answers[f.key];
      if (!isEmptyAnswer(v)) seen[f.key] = v;
    }
    if (fields.length > 0) path.push({ page, fields });
  }
  return path;
}

export interface CheckOptions {
  readonly registrationTypeId: string;
  /**
   * Pages whose required questions must be answered: every page on the path (submit, the
   * default), the page being left (next), or none (saving a draft).
   */
  readonly requirePages?: 'all' | readonly string[];
  /**
   * Answers off the path that may be dropped instead of rejected: only the respondent's own
   * stored draft answers, after they changed an earlier answer. Anything the caller sends now is
   * rejected when it is off the path.
   */
  readonly dropHidden?: (key: string) => boolean;
}

export interface RegistrationCheck {
  /** The answers to store: normalized, on the path only. */
  readonly answers: Record<string, unknown>;
  /** Page keys on the path, in order, with their visible question keys. */
  readonly path: readonly { readonly page: string; readonly fields: readonly string[] }[];
  /** Consent boxes that were checked, with the term and version the respondent saw. */
  readonly consents: readonly { readonly key: string; readonly term: string; readonly version: number }[];
}

/**
 * Server authority for the registration kind: recompute the path from the registration type and
 * the answers, validate and normalize every answer on it, enforce required questions on the
 * pages asked for, and **reject** (never silently drop) an answer to a question the respondent
 * cannot see: an unknown key, a question for another registration type, or one on a hidden page
 * or behind a false condition. Throws `AnswerError` naming the question.
 */
export function checkRegistrationAnswers(
  def: RegistrationFormDefinition,
  input: Answers,
  opts: CheckOptions,
): RegistrationCheck {
  const byKey = new Map(def.pages.flatMap((p) => p.fields.map((f) => [f.key, f] as const)));
  for (const k of Object.keys(input)) if (!byKey.has(k)) throw new AnswerError(k, 'Unknown question');
  const required = (page: string) =>
    opts.requirePages === undefined || opts.requirePages === 'all' || opts.requirePages.includes(page);
  const out: Record<string, unknown> = {};
  const onPath = new Set<string>();
  const path: { page: string; fields: string[] }[] = [];
  const typeId = opts.registrationTypeId;
  for (const page of def.pages) {
    if (!typeAllows(page.registrationTypes, typeId)) continue;
    if (page.showIf !== null && !evaluate(page.showIf as Logic, out)) continue;
    const fields: string[] = [];
    for (const f of page.fields) {
      if (!typeAllows(f.registrationTypes, typeId)) continue;
      if (f.showIf !== null && !evaluate(f.showIf as Logic, out)) continue;
      fields.push(f.key);
      onPath.add(f.key);
      const raw = input[f.key];
      if (isEmptyAnswer(raw)) {
        if (f.required && required(page.key)) throw new AnswerError(f.key, 'Required');
        continue;
      }
      const v = normalizeRegistration(f, raw);
      if (v === false && f.required && required(page.key)) throw new AnswerError(f.key, 'Required');
      out[f.key] = v;
    }
    if (fields.length > 0) path.push({ page: page.key, fields });
  }
  for (const [k, v] of Object.entries(input)) {
    if (onPath.has(k) || isBlank(v) || opts.dropHidden?.(k)) continue;
    throw new AnswerError(k, 'Not on your path');
  }
  const consents = [];
  for (const [k, v] of Object.entries(out)) {
    const f = byKey.get(k);
    if (f?.type === 'consent' && v === true && f.consent)
      consents.push({ key: k, term: f.consent.term, version: f.consent.version });
  }
  return { answers: out, path, consents };
}

/** One answer, normalized: the checkout types as checkout questions, plus the registration ones. */
export function normalizeRegistration(f: RegistrationField, raw: unknown): unknown {
  const bad = (m: string) => new AnswerError(f.key, m);
  switch (f.type) {
    case 'company':
    case 'job_title': {
      if (typeof raw !== 'string') throw bad('Text expected');
      const v = raw.trim().replace(/\s+/g, ' ');
      if (v.length > (f.type === 'company' ? COMPANY_MAX : JOB_TITLE_MAX)) throw bad('Too long');
      return v;
    }
    case 'consent': {
      if (raw === true || raw === 'true' || raw === 'on' || raw === '1') return true;
      if (raw === false || raw === 'false' || raw === '0') return false;
      throw bad('Checkbox expected');
    }
    default:
      return normalize(f as unknown as FieldDefinition, raw);
  }
}

/** A question as sent to the respondent: no registration type list (other types stay unseen). */
export type RespondentField = Omit<RegistrationField, 'registrationTypes'>;

export interface RespondentPage {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  /**
   * The page's questions for this registration type. Questions whose condition depends only on
   * earlier pages are already decided (hidden ones are left out); a condition on an earlier
   * question of the same page is kept for the browser to evaluate as the person types.
   */
  readonly fields: readonly RespondentField[];
  /** Earlier answers the kept conditions read (the respondent's own). */
  readonly context: Readonly<Record<string, unknown>>;
}

/** What the respondent is sent for one page on their path (null when it is not on it). */
export function respondentPage(
  def: RegistrationFormDefinition,
  typeId: string,
  answers: Answers,
  pageKey: string,
): RespondentPage | null {
  const path = computePath(def, typeId, answers);
  const at = path.find((p) => p.page.key === pageKey);
  if (!at) return null;
  const page = at.page;
  const samePage = new Set(page.fields.map((f) => f.key));
  // Answers on the path before this page (what its conditions may read).
  const earlier: Record<string, unknown> = {};
  for (const p of path) {
    if (p.page.key === pageKey) break;
    for (const f of p.fields) if (!isEmptyAnswer(answers[f.key])) earlier[f.key] = answers[f.key];
  }
  const fields: RegistrationField[] = [];
  const context: Record<string, unknown> = {};
  for (const f of page.fields) {
    if (!typeAllows(f.registrationTypes, typeId)) continue;
    const vars = logicVars(f.showIf);
    if (vars.some((v) => samePage.has(v))) {
      for (const v of vars) if (!samePage.has(v) && v in earlier) context[v] = earlier[v];
      fields.push(f);
    } else if (f.showIf === null || evaluate(f.showIf as Logic, earlier)) {
      fields.push({ ...f, showIf: null });
    }
  }
  return { key: page.key, title: page.title, description: page.description, fields, context };
}

/**
 * Which of a page's questions show right now in the browser (same-page conditions, typed
 * answers), given the context the server sent.
 */
export function visibleOnPage(page: RespondentPage, values: Answers): readonly RespondentField[] {
  const seen: Record<string, unknown> = { ...page.context };
  const out: RespondentField[] = [];
  for (const f of page.fields) {
    if (f.showIf !== null && !evaluate(f.showIf as Logic, seen)) continue;
    out.push(f);
    if (!isEmptyAnswer(values[f.key])) seen[f.key] = values[f.key];
  }
  return out;
}
