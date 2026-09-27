import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSerializer, IanaTimezone, Slug } from '../src/index.ts';

describe('defineSerializer', () => {
  const Organizer = z.object({
    id: z.string(),
    name: z.string(),
    owner: z.object({ name: z.string() }),
    links: z.array(z.object({ url: z.string() })),
  });
  const s = defineSerializer('organizer', Organizer);

  it('drops every key the schema does not declare, at every depth', () => {
    const row = {
      id: 'o1',
      name: 'ABC',
      bank_account_number: '__CANARY_bank__',
      owner: { name: 'Pat', password: '__CANARY_pw__', fcm_token: 'x' },
      links: [{ url: 'https://a', stripe_secret: '__CANARY_stripe__' }],
    };
    const out = s.serialize(row);
    expect(JSON.stringify(out)).not.toContain('__CANARY_');
    expect(out).toEqual({ id: 'o1', name: 'ABC', owner: { name: 'Pat' }, links: [{ url: 'https://a' }] });
  });

  it('refuses schemas that pass unknown keys through', () => {
    expect(() => defineSerializer('bad', z.looseObject({ id: z.string() }))).toThrow(/unknown keys/);
    expect(() =>
      defineSerializer(
        'bad-nested',
        z.object({ a: z.array(z.object({ b: z.string() }).catchall(z.string())) }),
      ),
    ).toThrow(/unknown keys/);
    expect(() => defineSerializer('ok-strict', z.strictObject({ id: z.string() }))).not.toThrow();
  });
});

describe('common schemas', () => {
  it('validates slugs and timezones', () => {
    expect(Slug.safeParse('abc-2027').success).toBe(true);
    expect(Slug.safeParse('-bad').success).toBe(false);
    expect(IanaTimezone.safeParse('America/New_York').success).toBe(true);
    expect(IanaTimezone.safeParse('Mars/Olympus').success).toBe(false);
  });
});
