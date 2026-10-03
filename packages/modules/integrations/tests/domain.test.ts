import { describe, expect, it } from 'vitest';
import {
  applyMapping,
  applyTransform,
  decidePull,
  decidePush,
  type FieldSpec,
  MAX_RECORD_ATTEMPTS,
  MappingRule,
  nextSyncAt,
  originStamp,
  recordRetryAt,
  TRANSFORMS,
  validateMapping,
} from '../src/client.ts';
import { defineConnector, demoConnector, redactSecrets } from '../src/index.ts';

const sources: FieldSpec[] = [
  { key: 'email_address', label: 'email_address', type: 'string' },
  { key: 'full_name', label: 'full_name', type: 'string' },
  { key: 'age', label: 'age', type: 'string' },
];
const targets: FieldSpec[] = [
  { key: 'email', label: 'email', type: 'email', required: true },
  { key: 'name', label: 'name', type: 'string' },
  { key: 'years', label: 'years', type: 'number' },
];
const rule = (source: string, target: string, transform = 'none', d: string | null = null) =>
  MappingRule.parse({ source, target, transform, default: d });

describe('field mapping (M6.4a)', () => {
  it('validates sources, targets, duplicates and required targets', () => {
    expect(validateMapping([rule('email_address', 'email')], sources, targets)).toEqual([]);
    expect(validateMapping([rule('nope', 'email'), rule('full_name', 'nope')], sources, targets)).toEqual([
      { code: 'unknown_source', field: 'nope', index: 0 },
      { code: 'unknown_target', field: 'nope', index: 1 },
    ]);
    expect(validateMapping([rule('full_name', 'name')], sources, targets)).toEqual([
      { code: 'missing_required', field: 'email', index: null },
    ]);
    expect(
      validateMapping([rule('email_address', 'email'), rule('full_name', 'email')], sources, targets),
    ).toEqual([{ code: 'duplicate_target', field: 'email', index: 1 }]);
  });

  it('refuses transforms outside the allowlist and malformed field keys', () => {
    expect(MappingRule.safeParse({ source: 'a', target: 'b', transform: 'eval' }).success).toBe(false);
    expect(MappingRule.safeParse({ source: 'A b', target: 'b' }).success).toBe(false);
    expect(TRANSFORMS).toContain('title_case');
  });

  it('applies each transform', () => {
    expect(applyTransform('trim', '  a ')).toBe('a');
    expect(applyTransform('lowercase', 'AbC')).toBe('abc');
    expect(applyTransform('uppercase', 'abc')).toBe('ABC');
    expect(applyTransform('title_case', 'aDA  lovelace')).toBe('Ada Lovelace');
    expect(applyTransform('first_word', ' Ada Byron Lovelace')).toBe('Ada');
    expect(applyTransform('last_word', 'Ada Byron Lovelace')).toBe('Lovelace');
    expect(applyTransform('last_word', 'Ada')).toBeNull();
    expect(applyTransform('to_number', '1,234.5')).toBe(1234.5);
    expect(() => applyTransform('to_number', 'abc')).toThrow();
    expect(applyTransform('to_boolean', 'Yes')).toBe(true);
    expect(applyTransform('to_boolean', '0')).toBe(false);
    expect(() => applyTransform('to_boolean', 'maybe')).toThrow();
    expect(applyTransform('to_date', '2026-10-02T10:00:00Z')).toBe('2026-10-02T10:00:00.000Z');
    expect(() => applyTransform('to_date', 'never')).toThrow();
    expect(applyTransform('none', 5)).toBe(5);
  });

  it('maps a record with defaults, transforms and type checks; failures name the field, never the value', () => {
    const rules = [
      rule('email_address', 'email', 'lowercase'),
      rule('full_name', 'name', 'trim', 'Guest'),
      rule('age', 'years', 'to_number'),
    ];
    expect(applyMapping({ email_address: 'A@B.CO', full_name: '', age: '41' }, rules, targets)).toEqual({
      ok: true,
      values: { email: 'a@b.co', name: 'Guest', years: 41 },
    });
    expect(applyMapping({ email_address: 'broken-record' }, rules, targets)).toEqual({
      ok: false,
      code: 'invalid_value',
      field: 'email',
    });
    expect(applyMapping({ full_name: 'x' }, rules, targets)).toEqual({
      ok: false,
      code: 'missing_required',
      field: 'email',
    });
    const bad = applyMapping({ email_address: 'a@b.co', age: 'old' }, rules, targets);
    expect(bad).toEqual({ ok: false, code: 'transform_failed', field: 'years' });
    expect(JSON.stringify(bad)).not.toContain('old');
  });
});

describe('sync rules (M6.4a)', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('backs off record retries (1, 5, 15, 60, 240 min) then waits for a person', () => {
    expect(recordRetryAt(1, now)?.toISOString()).toBe('2026-10-02T12:01:00.000Z');
    expect(recordRetryAt(2, now)?.toISOString()).toBe('2026-10-02T12:05:00.000Z');
    expect(recordRetryAt(4, now)?.toISOString()).toBe('2026-10-02T13:00:00.000Z');
    expect(recordRetryAt(MAX_RECORD_ATTEMPTS, now)).toBeNull();
  });

  it('schedules the next sync by interval, or backs off after failures (never past the interval)', () => {
    expect(nextSyncAt(now, 60, 0).toISOString()).toBe('2026-10-02T13:00:00.000Z');
    expect(nextSyncAt(now, 60, 1).toISOString()).toBe('2026-10-02T12:05:00.000Z');
    expect(nextSyncAt(now, 60, 2).toISOString()).toBe('2026-10-02T12:10:00.000Z');
    expect(nextSyncAt(now, 60, 9).toISOString()).toBe('2026-10-02T13:00:00.000Z');
  });

  it('loop guard: skips versions already applied, our own origin, and older remote changes', () => {
    const own = originStamp('c1');
    const link = { remoteVersion: '7', localHash: 'h1', lastSyncedAt: now };
    const remote = (version: string, origin: string | null = null, at: Date | null = now) => ({
      version,
      origin,
      updatedAt: at,
    });
    expect(decidePull(remote('7'), link, own, null)).toEqual({ action: 'skip', reason: 'unchanged' });
    expect(decidePull(remote('8', own), link, own, null)).toEqual({ action: 'skip', reason: 'own_write' });
    expect(
      decidePull(remote('8', null, new Date('2026-10-02T11:00:00Z')), link, own, {
        hash: 'h2',
        updatedAt: now,
      }),
    ).toEqual({ action: 'skip', reason: 'local_newer' });
    expect(decidePull(remote('8'), link, own, { hash: 'h1', updatedAt: now })).toEqual({ action: 'apply' });
    expect(decidePull(remote('1'), null, own, null)).toEqual({ action: 'apply' });
    expect(decidePush('h1', link)).toEqual({ action: 'skip', reason: 'unchanged' });
    expect(decidePush('h2', link)).toEqual({ action: 'send' });
    expect(decidePush('h2', null)).toEqual({ action: 'send' });
  });
});

describe('connector SDK (M6.4a)', () => {
  it('the demo connector is valid and fake-only', () => {
    expect(demoConnector.availability).toBe('fake_only');
    expect(demoConnector.objects.map((o) => o.key)).toEqual(['contacts']);
  });

  it('rejects bad keys, empty objects and invalid default mappings', () => {
    const base = { ...demoConnector };
    expect(() => defineConnector({ ...base, key: 'Bad Key' })).toThrow(/snake_case/);
    expect(() => defineConnector({ ...base, objects: [] })).toThrow(/no objects/);
    const [contacts] = demoConnector.objects;
    const pull = contacts?.pull;
    if (!contacts || !pull) throw new Error('demo has a pull side');
    expect(() =>
      defineConnector({
        ...base,
        objects: [{ ...contacts, pull: { ...pull, defaultMapping: [] } }],
      }),
    ).toThrow(/default pull mapping/);
  });
});

describe('redactSecrets', () => {
  it('strips bearer credentials, token pairs and JWTs', () => {
    const out = redactSecrets(
      'GET failed: Authorization: Bearer abcdef123456 access_token=zzzz9999 refresh_token":"qqqq8888" eyJhbGciOiJI.eyJzdWIiOiIx.c2ln',
    );
    expect(out).not.toMatch(/abcdef123456|zzzz9999|qqqq8888|eyJhbGci/);
    expect(out).toContain('[redacted]');
    expect(redactSecrets('x'.repeat(400)).length).toBe(300);
  });
});
