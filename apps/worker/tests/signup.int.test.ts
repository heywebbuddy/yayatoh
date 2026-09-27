import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { agreementsQuery, listMembersQuery, signUpOrganization, signupCodeValid } from '@yayatoh/tenancy';
import { ports } from '@yayatoh/testing';
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
