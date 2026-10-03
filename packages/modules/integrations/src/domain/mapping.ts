import { z } from 'zod';

/**
 * Field mapping (M6.4a): one model for every connector. A rule takes a source field, an optional
 * default (used when the source is empty) and one transform from a small allowlist, and writes a
 * target field. Pull rules read the remote record and write Yayatoh fields; push rules read the
 * Yayatoh record and write remote fields. Pure and browser-safe (the mapping editor uses it).
 */

/** The transforms a rule may use. Nothing else runs on a value: no expressions, no code. */
export const TRANSFORMS = [
  'none',
  'trim',
  'lowercase',
  'uppercase',
  'title_case',
  'first_word',
  'last_word',
  'to_number',
  'to_boolean',
  'to_date',
] as const;
export type Transform = (typeof TRANSFORMS)[number];

export const MAPPING_DIRECTIONS = ['pull', 'push'] as const;
export type MappingDirection = (typeof MAPPING_DIRECTIONS)[number];

export const FIELD_TYPES = ['string', 'email', 'number', 'boolean', 'date'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** A field a connector offers on one side of a mapping. */
export interface FieldSpec {
  readonly key: string;
  /** A display name: the provider's own field name (not translated) for remote fields. */
  readonly label: string;
  readonly type: FieldType;
  /** A target that every mapped record must carry (e.g. the contact's email). */
  readonly required?: boolean;
}

export const FIELD_KEY = /^[a-z][a-z0-9_]{0,62}$/;
export const MAX_RULES = 50;
export const MAX_DEFAULT = 200;

export const MappingRule = z.object({
  source: z.string().regex(FIELD_KEY),
  target: z.string().regex(FIELD_KEY),
  transform: z.enum(TRANSFORMS).default('none'),
  default: z.string().max(MAX_DEFAULT).nullable().default(null),
});
export type MappingRule = z.infer<typeof MappingRule>;
export const MappingRules = z.array(MappingRule).max(MAX_RULES);

export type MappingProblem =
  | { readonly code: 'unknown_source'; readonly field: string; readonly index: number }
  | { readonly code: 'unknown_target'; readonly field: string; readonly index: number }
  | { readonly code: 'duplicate_target'; readonly field: string; readonly index: number }
  | { readonly code: 'missing_required'; readonly field: string; readonly index: null };

/**
 * Check a rule list against the connector's fields: every source and target exists, a target is
 * written once, and every required target has a rule. Returns every problem (the editor shows each
 * next to its row); an empty list means the mapping can be saved.
 */
export function validateMapping(
  rules: readonly MappingRule[],
  sources: readonly FieldSpec[],
  targets: readonly FieldSpec[],
): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const sourceKeys = new Set(sources.map((f) => f.key));
  const targetKeys = new Set(targets.map((f) => f.key));
  const seen = new Set<string>();
  rules.forEach((r, index) => {
    if (!sourceKeys.has(r.source)) problems.push({ code: 'unknown_source', field: r.source, index });
    if (!targetKeys.has(r.target)) problems.push({ code: 'unknown_target', field: r.target, index });
    else if (seen.has(r.target)) problems.push({ code: 'duplicate_target', field: r.target, index });
    seen.add(r.target);
  });
  for (const t of targets)
    if (t.required && !seen.has(t.key))
      problems.push({ code: 'missing_required', field: t.key, index: null });
  return problems;
}

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Apply one transform. Throws `TransformError` when the value cannot be converted. */
export function applyTransform(transform: Transform, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  switch (transform) {
    case 'none':
      return value;
    case 'trim':
      return text.trim();
    case 'lowercase':
      return text.toLowerCase();
    case 'uppercase':
      return text.toUpperCase();
    case 'title_case':
      return words(text)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    case 'first_word':
      return words(text)[0] ?? null;
    case 'last_word': {
      const w = words(text);
      return w.length > 1 ? (w[w.length - 1] ?? null) : null;
    }
    case 'to_number': {
      if (typeof value === 'number') return value;
      const n = Number(text.trim().replace(/,/g, ''));
      if (text.trim() === '' || !Number.isFinite(n)) throw new TransformError(transform);
      return n;
    }
    case 'to_boolean': {
      if (typeof value === 'boolean') return value;
      const t = text.trim().toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(t)) return true;
      if (['false', 'no', 'n', '0'].includes(t)) return false;
      throw new TransformError(transform);
    }
    case 'to_date': {
      const d = value instanceof Date ? value : new Date(text.trim());
      if (Number.isNaN(d.getTime())) throw new TransformError(transform);
      return d.toISOString();
    }
  }
}

export class TransformError extends Error {
  readonly transform: Transform;
  constructor(transform: Transform) {
    super(`The value could not be converted (${transform})`);
    this.name = 'TransformError';
    this.transform = transform;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a mapped value fits its target's type (after the transform). */
export function fitsType(type: FieldType, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length <= 1000;
    case 'email':
      return typeof value === 'string' && value.length <= 320 && EMAIL.test(value.trim());
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
  }
}

export type MappedRecord =
  | { readonly ok: true; readonly values: Readonly<Record<string, unknown>> }
  | {
      readonly ok: false;
      /** A stable code for the errors inbox; the field names the target (never the value). */
      readonly code: 'missing_required' | 'invalid_value' | 'transform_failed';
      readonly field: string;
    };

/**
 * Map one record. For each rule: the source value (or the default when it is empty), then the
 * transform, then a type check against the target. Required targets must end up non-empty.
 * Values never appear in a failure (it names the field), so the errors inbox carries no data.
 */
export function applyMapping(
  record: Readonly<Record<string, unknown>>,
  rules: readonly MappingRule[],
  targets: readonly FieldSpec[],
): MappedRecord {
  const byKey = new Map(targets.map((t) => [t.key, t]));
  const values: Record<string, unknown> = {};
  for (const r of rules) {
    const target = byKey.get(r.target);
    if (!target) continue;
    const raw = record[r.source];
    const start = isEmpty(raw) ? r.default : raw;
    let value: unknown;
    try {
      value = isEmpty(start) ? null : applyTransform(r.transform, start);
    } catch {
      return { ok: false, code: 'transform_failed', field: r.target };
    }
    if (typeof value === 'string' && target.type !== 'string') value = value.trim();
    if (!fitsType(target.type, value)) return { ok: false, code: 'invalid_value', field: r.target };
    values[r.target] = value;
  }
  for (const t of targets)
    if (t.required && isEmpty(values[t.key])) return { ok: false, code: 'missing_required', field: t.key };
  return { ok: true, values };
}
