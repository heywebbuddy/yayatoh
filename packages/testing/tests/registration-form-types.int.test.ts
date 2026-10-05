import { closePools } from '@yayatoh/db/testing';
import {
  computePath,
  getRegistrationFormQuery,
  publicRespondent,
  publishRegistrationFormCommand,
  startRegistrationFormCommand,
} from '@yayatoh/forms';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  publicRegistration,
  type RegistrationTypeRef,
  registrationTypeRefsQuery,
} from '@yayatoh/registration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs } from '../src/index.ts';

/**
 * Batch 3e wiring: M5.1b's per-type form paths run on M5.1a's registration types. The fixture
 * event's form gets one page per real type (Member, the code-only Press type, the domain-only
 * Staff type, all from the fixture); a respondent of each type gets the shared page plus their
 * own, and the evaluation context carries the type's real id.
 */

let a: OrgFixture;
let b: OrgFixture;
let types: { member: RegistrationTypeRef; press: RegistrationTypeRef; staff: RegistrationTypeRef };

const eventName = async () => 'Fixture event';

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const refs = await executeQuery(registrationTypeRefsQuery, { eventId: a.event.id }, a.ctx(), ports);
  const by = (pred: (r: RegistrationTypeRef) => boolean) => {
    const r = refs.find(pred);
    if (!r) throw new Error('fixture type missing');
    return r;
  };
  types = {
    member: by((r) => r.key === 'member'),
    press: by((r) => r.name === 'Press'),
    staff: by((r) => r.name === 'Staff'),
  };
  const form = await executeQuery(getRegistrationFormQuery, { eventId: a.event.id }, a.ctx(), ports);
  if (!form) throw new Error('fixture form missing');
  const own = (key: string, title: string, type: RegistrationTypeRef) => ({
    key,
    title,
    registrationTypes: [type.id],
    fields: [{ key: `${key}_note`, type: 'short_text', label: `${title} note` }],
  });
  await executeCommand(
    publishRegistrationFormCommand,
    {
      eventId: a.event.id,
      expectedVersion: form.version,
      definition: {
        pages: [
          ...form.definition.pages,
          own('membership', 'Membership', types.member),
          own('press', 'Press desk', types.press),
          own('staff', 'Staff rota', types.staff),
        ],
      },
    },
    a.ctx(),
    ports,
  );
});
afterAll(async () => {
  await closePools();
});

describe('registration form paths on registration types (batch 3e: M5.1a × M5.1b)', () => {
  it('the fixture form shows each real type its own pages', async () => {
    const form = await executeQuery(getRegistrationFormQuery, { eventId: a.event.id }, a.ctx(), ports);
    if (!form) throw new Error('no form');
    const pagesOf = (t: RegistrationTypeRef) => computePath(form.definition, t.id, {}).map((p) => p.page.key);
    expect(pagesOf(types.member)).toEqual(['about', 'membership']);
    expect(pagesOf(types.press)).toEqual(['about', 'press']);
    expect(pagesOf(types.staff)).toEqual(['about', 'staff']);

    for (const [t, own] of [
      [types.member, 'Membership'],
      [types.press, 'Press desk'],
      [types.staff, 'Staff rota'],
    ] as const) {
      const { token } = await executeCommand(
        startRegistrationFormCommand,
        { eventId: a.event.id, registrationTypeId: t.id, name: `${t.name} Person`, email: 'p@example.test' },
        createCtx({ orgId: a.org.id }),
        ports,
      );
      const view = await publicRespondent(token, { eventName });
      expect(view).toMatchObject({ registrationTypeId: t.id, step: 1, steps: 2 });
      // The respondent never sees another type's page.
      expect(JSON.stringify(view)).not.toContain(own === 'Membership' ? 'Press desk' : 'Membership');
    }
  });

  it('the public start offers only the types the person may pick (M5.1a eligibility)', async () => {
    const anyone = await publicRegistration(a.org.id, a.event.id, { email: 'p@elsewhere.test' });
    const ids = anyone.types.map((t) => t.id);
    expect(ids).toContain(types.member.id);
    // Code-only Press and the Staff domain stay closed without the code or the domain.
    expect(ids).not.toContain(types.press.id);
    expect(ids).not.toContain(types.staff.id);
    const staff = await publicRegistration(a.org.id, a.event.id, { email: 'p@example.test' });
    expect(staff.types.map((t) => t.id)).toContain(types.staff.id);
  });

  it('another org sees none of these types', async () => {
    const seen = await executeQuery(registrationTypeRefsQuery, { eventId: a.event.id }, b.ctx(), ports).catch(
      (err: { code?: string }) => err.code,
    );
    expect(seen === 'not_found' || (Array.isArray(seen) && seen.length === 0)).toBe(true);
  });
});
