'use server';

import { currentTermVersion, isConsentTerm } from '@yayatoh/crm';
import {
  getRegistrationFormQuery,
  publishRegistrationFormCommand,
  type RegistrationField,
  RegistrationFormDefinition,
  type RegistrationPage,
  setJobTitlesCommand,
} from '@yayatoh/forms';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import type { FormState } from '@/lib/form-state.ts';
import { CONDITION_OPS, type ConditionOp, toLogic, typedValue } from '@/lib/registration-conditions.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { consoleRegistrationTypes } from '@/server/registration-types.ts';

type Page = RegistrationPage;
type Field = RegistrationField;

/** Builder reasons for a definition the engine refuses (shown under the form that caused it). */
function reasonOf(message: string | undefined): string {
  if (message === 'A condition can only use earlier questions') return 'condition_order';
  if (message === 'Add at least one option') return 'options';
  if (message === 'Choose a consent term') return 'consent_term';
  return 'invalid';
}

/**
 * Every change publishes a new immutable version (respondents who started keep theirs). The
 * definition is checked here first so the builder can say why a change is refused.
 */
async function edit(
  org: string,
  event: string,
  form: FormData,
  change: (pages: Page[]) => Page[],
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  // The version the builder showed: a publish from an older one is refused (another editor won).
  const seen = Number(form.get('version'));
  const expectedVersion = Number.isInteger(seen) && seen >= 0 ? seen : undefined;
  try {
    const current = await executeQuery(getRegistrationFormQuery, { eventId: ev.id }, data.ctx, ports);
    const pages = change(structuredClone(current?.definition.pages ?? []));
    const checked = RegistrationFormDefinition.safeParse({ pages });
    if (!checked.success)
      return { ok: false, code: 'validation_failed', reason: reasonOf(checked.error.issues[0]?.message) };
    await executeCommand(
      publishRegistrationFormCommand,
      { eventId: ev.id, definition: { pages } },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/registration-form`);
  return success();
}

/** A stable key from a label ("Dietary needs?" → dietary_needs), unique among `taken`. */
function keyFor(label: string, taken: ReadonlySet<string>, fallback: string): string {
  const base =
    label
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || fallback;
  const start = /^[a-z]/.test(base) ? base : `${fallback}_${base}`.slice(0, 36);
  let key = start;
  for (let n = 2; taken.has(key); n++) key = `${start.slice(0, 34)}_${n}`;
  return key;
}

const allKeys = (pages: readonly Page[]) =>
  new Set([...pages.map((p) => p.key), ...pages.flatMap((p) => p.fields.map((f) => f.key))]);

/** Chosen registration types from the form: null (all) unless "Only some types" is picked. */
async function typesFrom(org: string, event: string, form: FormData): Promise<string[] | null | 'invalid'> {
  if (form.get('audience') !== 'some') return null;
  const { data, event: ev } = await loadEvent(org, event);
  const known = new Set((await consoleRegistrationTypes(data, ev.id)).map((t) => t.id));
  const chosen = form.getAll('types').map(String);
  if (chosen.length === 0 || chosen.some((id) => !known.has(id))) return 'invalid';
  return [...new Set(chosen)];
}

/** The condition from the form ("Always", or question + operator + value), typed by the question. */
function conditionFrom(form: FormData, questions: readonly Field[]): unknown | 'invalid' | 'keep' {
  if (form.get('when') === 'keep') return 'keep';
  if (form.get('when') !== 'if') return null;
  const key = String(form.get('condKey') ?? '');
  const op = String(form.get('condOp') ?? 'eq') as ConditionOp;
  const q = questions.find((f) => f.key === key);
  if (!q || !(CONDITION_OPS as readonly string[]).includes(op)) return 'invalid';
  const raw = String(form.get('condValue') ?? '');
  const value = typedValue(q, raw);
  if (typeof value === 'number' && !Number.isFinite(value)) return 'invalid';
  if (value === '') return 'invalid';
  return toLogic({ key, op: q.type === 'multi_select' ? 'includes' : op, value });
}

/** Questions a page's condition may use: those on earlier pages. */
const before = (pages: readonly Page[], pageKey: string): Field[] => {
  const i = pages.findIndex((p) => p.key === pageKey);
  return pages.slice(0, i < 0 ? pages.length : i).flatMap((p) => p.fields);
};

const invalid = (reason: string): FormState => ({ ok: false, code: 'validation_failed', reason });

export async function addPageAction(org: string, event: string, _prev: FormState, form: FormData) {
  const title = String(form.get('title') ?? '').trim();
  if (!title) return { ok: false, code: 'validation_failed', fields: ['title'] } satisfies FormState;
  const t = await getTranslations('registrationForm');
  return edit(org, event, form, (pages) => [
    ...pages,
    {
      key: keyFor(title, allKeys(pages), 'page'),
      title: title.slice(0, 120),
      description:
        String(form.get('description') ?? '')
          .trim()
          .slice(0, 500) || null,
      showIf: null,
      registrationTypes: null,
      // A new page starts with one question so it shows; the organizer edits from there.
      fields: [
        {
          key: keyFor(t('starterQuestion'), allKeys(pages), 'q'),
          type: 'short_text',
          label: t('starterQuestion'),
          help: null,
          required: false,
          sensitive: false,
          options: [],
          min: null,
          max: null,
          showIf: null,
          registrationTypes: null,
          consent: null,
        },
      ],
    },
  ]);
}

export async function updatePageAction(
  org: string,
  event: string,
  pageKey: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const title = String(form.get('title') ?? '').trim();
  if (!title) return { ok: false, code: 'validation_failed', fields: ['title'] };
  const types = await typesFrom(org, event, form);
  if (types === 'invalid') return invalid('types');
  let bad = false;
  const r = await edit(org, event, form, (pages) =>
    pages.map((p) => {
      if (p.key !== pageKey) return p;
      const showIf = conditionFrom(form, before(pages, pageKey));
      if (showIf === 'invalid') bad = true;
      return {
        ...p,
        title: title.slice(0, 120),
        description:
          String(form.get('description') ?? '')
            .trim()
            .slice(0, 500) || null,
        registrationTypes: types,
        showIf: showIf === 'invalid' || showIf === 'keep' ? p.showIf : showIf,
      };
    }),
  );
  return bad ? invalid('condition') : r;
}

function moveIn<T extends { key: string }>(list: T[], key: string, by: -1 | 1): T[] {
  const i = list.findIndex((x) => x.key === key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j] as T, next[i] as T];
  return next;
}

export async function movePageAction(
  org: string,
  event: string,
  pageKey: string,
  by: -1 | 1,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return edit(org, event, form, (pages) => moveIn(pages, pageKey, by));
}

export async function removePageAction(
  org: string,
  event: string,
  pageKey: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return edit(org, event, form, (pages) => pages.filter((p) => p.key !== pageKey));
}

const CHOICE = new Set(['select', 'multi_select']);

export async function addFieldAction(
  org: string,
  event: string,
  pageKey: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const type = String(form.get('type') ?? 'short_text') as Field['type'];
  const term = String(form.get('term') ?? '');
  let label = String(form.get('label') ?? '').trim();
  if (type === 'consent') {
    if (!isConsentTerm(term)) return invalid('consent_term');
    // The checkbox shows the term's versioned wording; the label only names it in the builder.
    if (!label) label = (await getTranslations('registrationForm.terms'))(term);
  }
  if (!label) return { ok: false, code: 'validation_failed', fields: ['label'] };
  const options = String(form.get('options') ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => ({ value: keyFor(l, new Set(), `o${i + 1}`), label: l.slice(0, 120) }));
  const types = await typesFrom(org, event, form);
  if (types === 'invalid') return invalid('types');
  let bad = false;
  const r = await edit(org, event, form, (pages) =>
    pages.map((p) => {
      if (p.key !== pageKey) return p;
      const showIf = conditionFrom(form, [...before(pages, pageKey), ...p.fields]);
      if (showIf === 'invalid') bad = true;
      const max = String(form.get('max') ?? '').trim();
      return {
        ...p,
        fields: [
          ...p.fields,
          {
            key: keyFor(label, allKeys(pages), 'q'),
            type,
            label: label.slice(0, 200),
            help:
              String(form.get('help') ?? '')
                .trim()
                .slice(0, 300) || null,
            required: type !== 'consent' && form.get('required') === '1',
            sensitive: type !== 'consent' && form.get('sensitive') === '1',
            options: CHOICE.has(type) ? options : [],
            min: null,
            max: (type === 'count' || type === 'number') && max ? Number(max) : null,
            showIf: showIf === 'invalid' || showIf === 'keep' ? null : showIf,
            registrationTypes: types,
            consent:
              type === 'consent' && isConsentTerm(term) ? { term, version: currentTermVersion(term) } : null,
          },
        ],
      };
    }),
  );
  return bad ? invalid('condition') : r;
}

export async function updateFieldAction(
  org: string,
  event: string,
  pageKey: string,
  fieldKey: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const types = await typesFrom(org, event, form);
  if (types === 'invalid') return invalid('types');
  let bad = false;
  const r = await edit(org, event, form, (pages) =>
    pages.map((p) => {
      if (p.key !== pageKey) return p;
      const i = p.fields.findIndex((f) => f.key === fieldKey);
      const showIf = conditionFrom(form, [...before(pages, pageKey), ...p.fields.slice(0, Math.max(i, 0))]);
      if (showIf === 'invalid') bad = true;
      return {
        ...p,
        fields: p.fields.map((f) =>
          f.key !== fieldKey
            ? f
            : {
                ...f,
                required: f.type !== 'consent' && form.get('required') === '1',
                registrationTypes: types,
                showIf: showIf === 'invalid' || showIf === 'keep' ? f.showIf : showIf,
              },
        ),
      };
    }),
  );
  return bad ? invalid('condition') : r;
}

export async function moveFieldAction(
  org: string,
  event: string,
  pageKey: string,
  fieldKey: string,
  by: -1 | 1,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return edit(org, event, form, (pages) =>
    pages.map((p) => (p.key === pageKey ? { ...p, fields: moveIn(p.fields, fieldKey, by) } : p)),
  );
}

export async function removeFieldAction(
  org: string,
  event: string,
  pageKey: string,
  fieldKey: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return edit(org, event, form, (pages) =>
    pages.map((p) => (p.key === pageKey ? { ...p, fields: p.fields.filter((f) => f.key !== fieldKey) } : p)),
  );
}

/** The org's job title list, one per line (order kept). */
export async function setJobTitlesAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event);
  const seen = new Set<string>();
  const titles = String(form.get('titles') ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()));
  if (titles.some((l) => l.length > 120)) return { ok: false, code: 'validation_failed', fields: ['titles'] };
  try {
    await executeCommand(setJobTitlesCommand, { titles }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/registration-form`);
  return success();
}
