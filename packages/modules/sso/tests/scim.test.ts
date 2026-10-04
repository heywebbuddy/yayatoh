import { describe, expect, it } from 'vitest';
import {
  applyGroupPatch,
  applyUserPatch,
  groupResource,
  parseFilter,
  parseGroup,
  parsePage,
  parsePatch,
  parseUser,
  ScimError,
  scimErrorBody,
  type UserFields,
  userResource,
} from '../src/domain/scim.ts';

const U1 = '01929b4a-0000-7000-8000-000000000001';
const U2 = '01929b4a-0000-7000-8000-000000000002';

const base: UserFields = {
  userName: 'jane@acme.com',
  email: 'jane@acme.com',
  externalId: '00u1',
  displayName: 'Jane Doe',
  givenName: 'Jane',
  familyName: 'Doe',
  active: true,
};

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScimError) return { status: e.status, scimType: e.scimType };
    throw e;
  }
  throw new Error('expected a ScimError');
};

describe('filters and paging', () => {
  it('parses attr eq "value" case-insensitively', () => {
    expect(parseFilter('userName eq "Jane@Acme.com"', ['userName'])).toEqual({
      attribute: 'userName',
      value: 'Jane@Acme.com',
    });
    expect(parseFilter('USERNAME EQ "a\\"b"', ['userName'])).toEqual({ attribute: 'userName', value: 'a"b' });
    expect(parseFilter(null, ['userName'])).toBeNull();
    expect(parseFilter('  ', ['userName'])).toBeNull();
  });
  it('refuses other operators and attributes', () => {
    expect(err(() => parseFilter('userName co "x"', ['userName']))).toEqual({
      status: 400,
      scimType: 'invalidFilter',
    });
    expect(err(() => parseFilter('title eq "x"', ['userName']))).toEqual({
      status: 400,
      scimType: 'invalidFilter',
    });
    expect(err(() => parseFilter('userName eq "a" and active eq true', ['userName']))).toEqual({
      status: 400,
      scimType: 'invalidFilter',
    });
  });
  it('pages from 1 with a capped count', () => {
    expect(parsePage({})).toEqual({ startIndex: 1, count: 200 });
    expect(parsePage({ startIndex: '0', count: '5000' })).toEqual({ startIndex: 1, count: 200 });
    expect(parsePage({ startIndex: '11', count: '10' })).toEqual({ startIndex: 11, count: 10 });
  });
});

describe('users', () => {
  it('reads an Okta-style create body', () => {
    const u = parseUser({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'Jane@Acme.com',
      name: { givenName: 'Jane', familyName: 'Doe' },
      emails: [{ primary: true, value: 'jane@acme.com', type: 'work' }],
      displayName: 'Jane Doe',
      active: true,
      externalId: '00u1',
    });
    expect(u).toEqual({ ...base, userName: 'Jane@Acme.com' });
  });
  it('uses the primary email when userName is not an address (Entra UPN)', () => {
    const u = parseUser({
      userName: 'jdoe',
      emails: [{ value: 'x@acme.com' }, { value: 'Jane@acme.com', primary: 'True' }],
    });
    expect(u.email).toBe('jane@acme.com');
    expect(u.active).toBe(true);
  });
  it('needs an address', () => {
    expect(err(() => parseUser({ userName: 'jdoe' }))).toEqual({ status: 400, scimType: 'invalidValue' });
    expect(err(() => parseUser({}))).toEqual({ status: 400, scimType: 'invalidValue' });
  });
  it('applies Entra PATCH operations (string booleans, capitalised ops)', () => {
    const ops = parsePatch({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        { op: 'Replace', path: 'active', value: 'False' },
        { op: 'Add', path: 'name.givenName', value: 'Janet' },
        { op: 'Replace', path: 'emails[type eq "work"].value', value: 'JANE@acme.com' },
      ],
    });
    expect(applyUserPatch(base, ops)).toEqual({ ...base, active: false, givenName: 'Janet' });
  });
  it('applies Okta path-less replace objects', () => {
    const ops = parsePatch({ Operations: [{ op: 'replace', value: { active: false, displayName: 'J' } }] });
    expect(applyUserPatch(base, ops)).toEqual({ ...base, active: false, displayName: 'J' });
  });
  it('removes optional attributes, never active, and refuses another address', () => {
    expect(
      applyUserPatch(base, parsePatch({ Operations: [{ op: 'remove', path: 'externalId' }] })).externalId,
    ).toBeNull();
    expect(
      err(() => applyUserPatch(base, parsePatch({ Operations: [{ op: 'remove', path: 'active' }] }))),
    ).toEqual({
      status: 400,
      scimType: 'mutability',
    });
    expect(
      err(() =>
        applyUserPatch(
          base,
          parsePatch({ Operations: [{ op: 'replace', path: 'userName', value: 'eve@acme.com' }] }),
        ),
      ),
    ).toEqual({ status: 400, scimType: 'mutability' });
    expect(
      applyUserPatch(
        base,
        parsePatch({ Operations: [{ op: 'replace', path: 'userName', value: 'JANE@acme.com' }] }),
      ).userName,
    ).toBe('JANE@acme.com');
    expect(err(() => parsePatch({ Operations: [{ op: 'move', path: 'x' }] }))).toEqual({
      status: 400,
      scimType: 'invalidSyntax',
    });
    expect(
      err(() =>
        applyUserPatch(base, parsePatch({ Operations: [{ op: 'replace', path: 'active', value: 'maybe' }] })),
      ),
    ).toEqual({
      status: 400,
      scimType: 'invalidValue',
    });
  });
});

describe('groups', () => {
  it('reads a group with members', () => {
    expect(
      parseGroup({ displayName: 'Engineering', members: [{ value: U1 }, { value: U1.toUpperCase() }] }),
    ).toEqual({
      displayName: 'Engineering',
      externalId: null,
      members: [U1],
    });
    expect(err(() => parseGroup({ displayName: 'x', members: [{ value: 'not-a-uuid' }] }))).toEqual({
      status: 400,
      scimType: 'invalidValue',
    });
  });
  it('adds, removes (by filter or list) and replaces members', () => {
    const g = { displayName: 'Eng', externalId: null, members: [U1] };
    const added = applyGroupPatch(
      g,
      parsePatch({ Operations: [{ op: 'add', path: 'members', value: [{ value: U2 }] }] }),
    );
    expect(added.members).toEqual([U1, U2]);
    const removed = applyGroupPatch(
      added,
      parsePatch({ Operations: [{ op: 'remove', path: `members[value eq "${U1}"]` }] }),
    );
    expect(removed.members).toEqual([U2]);
    expect(
      applyGroupPatch(
        added,
        parsePatch({ Operations: [{ op: 'remove', path: 'members', value: [{ value: U2 }] }] }),
      ).members,
    ).toEqual([U1]);
    expect(
      applyGroupPatch(added, parsePatch({ Operations: [{ op: 'remove', path: 'members' }] })).members,
    ).toEqual([]);
    const renamed = applyGroupPatch(
      g,
      parsePatch({
        Operations: [
          { op: 'replace', value: { id: 'x', displayName: 'Engineering', members: [{ value: U2 }] } },
        ],
      }),
    );
    expect(renamed).toEqual({ displayName: 'Engineering', externalId: null, members: [U2] });
    expect(
      err(() => applyGroupPatch(g, parsePatch({ Operations: [{ op: 'replace', path: 'owner', value: 1 }] }))),
    ).toEqual({
      status: 400,
      scimType: 'invalidPath',
    });
  });
});

describe('resources', () => {
  const at = new Date('2026-10-03T00:00:00Z');
  it('allowlists the user resource', () => {
    const r = userResource(
      { id: U1, ...base, createdAt: at, updatedAt: at, groups: [{ id: U2, displayName: 'Eng' }] },
      'https://app.test/api/scim/v2',
    );
    expect(r).toEqual({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: U1,
      externalId: '00u1',
      userName: 'jane@acme.com',
      displayName: 'Jane Doe',
      name: { givenName: 'Jane', familyName: 'Doe' },
      emails: [{ value: 'jane@acme.com', type: 'work', primary: true }],
      active: true,
      groups: [{ value: U2, display: 'Eng' }],
      meta: {
        resourceType: 'User',
        created: at.toISOString(),
        lastModified: at.toISOString(),
        location: `https://app.test/api/scim/v2/Users/${U1}`,
      },
    });
  });
  it('allowlists the group resource and errors', () => {
    const g = groupResource(
      {
        id: U2,
        displayName: 'Eng',
        externalId: null,
        createdAt: at,
        updatedAt: at,
        members: [{ id: U1, userName: 'j' }],
      },
      'https://app.test/api/scim/v2',
    );
    expect(g.members).toEqual([{ value: U1, display: 'j' }]);
    expect(g).not.toHaveProperty('externalId');
    expect(scimErrorBody(new ScimError(409, 'dup', 'uniqueness'))).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '409',
      scimType: 'uniqueness',
      detail: 'dup',
    });
  });
});
