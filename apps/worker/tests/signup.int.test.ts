import { withoutTenant } from '@yayatoh/db';
import { setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { agreementsQuery, listMembersQuery, signUpOrganization, signupCodeValid } from '@yayatoh/tenancy';
import { ports } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSignupCode, randomSignupCode } from '../src/signup-codes.ts';

const audited: string[] = [];
beforeAll(() => setPlatformAuditSink(async (a) => void audited.push(a.reason)));
afterAll(closePools);

const person = () => createCtx({ actor: { type: 'user', userId: uuidv7() } });
const input = (code: string, slug: string) => ({
  code,
  slug,
  name: 'Harbor Weddings',
  defaultProfile: 'wedding',
  acceptTerms: true,
});

describe('invite-only signup (M1.3b)', () => {
  it('a valid code creates an org with its owner, terms accepted, ready to publish; the code runs out', async () => {
    const { code } = await createSignupCode({ maxUses: 1, days: 7, note: 'harbor', createdBy: 'staff:test' });
    expect(code).toMatch(/^YY-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(audited.some((r) => r.includes('harbor'))).toBe(true);
    // Case and separators don't matter.
    expect(await signupCodeValid(code.toLowerCase().replaceAll('-', ' '))).toBe(true);
    const ctx = person();
    const slug = `harbor-${uuidv7().slice(-8)}`;
    const org = await signUpOrganization(ctx, input(code, slug), ports);
    expect(org).toMatchObject({ slug, defaultProfile: 'wedding' });
    const owner = { ...ctx, orgId: org.id };
    expect((await executeQuery(listMembersQuery, {}, owner, ports)).map((m) => m.role)).toEqual(['owner']);
    expect((await executeQuery(agreementsQuery, {}, owner, ports)).every((a) => a.acceptedAt)).toBe(true);
    const e = await executeCommand(
      createEventCommand,
      { name: 'Ceremony', timezone: 'UTC', startsAt: '2027-06-01T15:00:00Z', endsAt: '2027-06-01T23:00:00Z' },
      owner,
      ports,
    );
    await expect(
      executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, owner, ports),
    ).resolves.toMatchObject({ status: 'published' });
    // One use only.
    expect(await signupCodeValid(code)).toBe(false);
    await expect(
      signUpOrganization(person(), input(code, `x-${uuidv7().slice(-8)}`), ports),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'invalid_code' },
    });
  });

  it('a failed signup gives the use back; unknown, expired and system-actor signups are refused', async () => {
    const { code } = await createSignupCode({ maxUses: 1, days: 7, note: 'retry', createdBy: 'staff:test' });
    const taken = `taken-${uuidv7().slice(-8)}`;
    const other = await createSignupCode({ maxUses: 1, days: 7, note: 'first', createdBy: 'staff:test' });
    await signUpOrganization(person(), input(other.code, taken), ports);
    await expect(signUpOrganization(person(), input(code, taken), ports)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await signupCodeValid(code)).toBe(true);

    await expect(
      signUpOrganization(person(), input(randomSignupCode(), `n-${uuidv7().slice(-8)}`), ports),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const expired = await createSignupCode({ maxUses: 1, days: -1, note: 'old', createdBy: 'staff:test' });
    expect(await signupCodeValid(expired.code)).toBe(false);
    await expect(
      signUpOrganization(
        createCtx({ actor: { type: 'system', name: 'x' } }),
        input(code, `s-${uuidv7().slice(-8)}`),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Terms must be accepted in the form.
    await expect(
      signUpOrganization(person(), { ...input(code, `t-${uuidv7().slice(-8)}`), acceptTerms: false }, ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Reserved addresses are refused.
    await expect(signUpOrganization(person(), input(code, 'legal'), ports)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err).not.toBeNull();
  expect(`${err?.message} ${err?.cause?.message ?? ''}`).toMatch(re);
}

describe('signup codes in the staff console (M1.3f)', () => {
  const list = () =>
    withPlatformReader({ actor: 'staff:test', reason: 'test: list signup codes' }, (tx) =>
      tx.execute<Record<string, unknown>>(sql`select * from platform.list_signup_codes(500)`),
    );
  const revoke = (id: string) =>
    withPlatformReader(
      { actor: 'staff:test', reason: `test: revoke ${id}` },
      (tx) =>
        tx.execute<{ revoked: boolean }>(
          sql`select platform.revoke_signup_code(${id}::uuid, 'staff:revoker') as revoked`,
        ),
      { callsWritingFunctions: true },
    );

  it('lists codes with uses, expiry, note and creator but never the hash', async () => {
    const note = `listed-${uuidv7().slice(-8)}`;
    const { id } = await createSignupCode({ maxUses: 3, days: 5, note, createdBy: 'staff:test' });
    const row = (await list()).find((r) => r.id === id);
    expect(row).toMatchObject({ max_uses: 3, uses: 0, note, created_by: 'staff:test', revoked_at: null });
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'created_at',
        'created_by',
        'expires_at',
        'id',
        'max_uses',
        'note',
        'revoked_at',
        'revoked_by',
        'uses',
      ].sort(),
    );
  });

  it('a revoked code stops working at once, is revoked once, and records who revoked it', async () => {
    const { id, code } = await createSignupCode({
      maxUses: 5,
      days: 5,
      note: 'to revoke',
      createdBy: 'staff:test',
    });
    expect(await signupCodeValid(code)).toBe(true);
    expect((await revoke(id))[0]?.revoked).toBe(true);
    expect((await revoke(id))[0]?.revoked).toBe(false);
    expect(await signupCodeValid(code)).toBe(false);
    await expect(
      signUpOrganization(person(), input(code, `rv-${uuidv7().slice(-8)}`), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'code' } });
    expect((await list()).find((r) => r.id === id)).toMatchObject({ revoked_by: 'staff:revoker' });
    expect(audited).toContain(`test: revoke ${id}`);
  });

  it('the runtime role can neither list nor revoke; platform_reader still has no table access', async () => {
    await rejectsWith(
      withoutTenant((tx) => tx.execute(sql`select * from platform.list_signup_codes(10)`)),
      /permission denied/,
    );
    await rejectsWith(
      withoutTenant((tx) => tx.execute(sql`select platform.revoke_signup_code(${uuidv7()}::uuid, 'x')`)),
      /permission denied/,
    );
    await rejectsWith(
      withPlatformReader({ actor: 'staff:test', reason: 'test: raw table' }, (tx) =>
        tx.execute(sql`select code_hash from platform.signup_codes limit 1`),
      ),
      /permission denied/,
    );
  });

  it('generated codes use the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++)
      expect(randomSignupCode()).toMatch(/^YY-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });
});
