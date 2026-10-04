import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ConsentFacts,
  hubspotContactAction,
  memberStatus,
  subscriptionStatus,
} from '../src/audience/consent.ts';
import type { FakeAccount } from '../src/auth/fake.ts';
import { hubspotFakeProvider } from '../src/connectors/hubspot/fake.ts';
import { hubspotConnector, parseHubspotContact } from '../src/connectors/hubspot/index.ts';
import { CONNECTORS } from '../src/connectors/index.ts';
import { klaviyoFakeProvider, klaviyoRemoteSet } from '../src/connectors/klaviyo/fake.ts';
import { klaviyoConnector, klaviyoStatus, parseKlaviyoProfile } from '../src/connectors/klaviyo/index.ts';
import {
  MAILCHIMP_LISTS,
  MAILCHIMP_SEED_UNSUBSCRIBED,
  mailchimpFakeProvider,
  mailchimpRemoteSet,
  subscriberHash,
} from '../src/connectors/mailchimp/fake.ts';
import { mailchimpConnector, parseMailchimpMember } from '../src/connectors/mailchimp/index.ts';
import { applyMapping, validateMapping } from '../src/domain/mapping.ts';

/**
 * M6.4d unit tests: the consent rules (with a property test over random consent states), the
 * connectors' parsers against the recorded response samples, and the fakes' consent behaviour.
 */

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

/** A small seeded PRNG (mulberry32): the property test is random but repeatable. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const CONSENTS = ['granted', 'withdrawn', 'unknown_legacy', null] as const;
function randomFacts(next: () => number): ConsentFacts {
  return {
    consent: CONSENTS[Math.floor(next() * CONSENTS.length)] ?? null,
    unsubscribed: next() < 0.3,
    suppressed: next() < 0.2,
    erased: next() < 0.1,
  };
}
const mayReceive = (f: ConsentFacts) =>
  f.consent === 'granted' && !f.unsubscribed && !f.suppressed && !f.erased;

describe('consent rules', () => {
  it('only express consent without any suppression is subscribed; suppressions win', () => {
    expect(
      subscriptionStatus({ consent: 'granted', unsubscribed: false, suppressed: false, erased: false }),
    ).toBe('subscribed');
    expect(
      subscriptionStatus({ consent: 'granted', unsubscribed: true, suppressed: false, erased: false }),
    ).toBe('unsubscribed');
    expect(
      subscriptionStatus({ consent: 'granted', unsubscribed: false, suppressed: true, erased: false }),
    ).toBe('unsubscribed');
    expect(
      subscriptionStatus({ consent: 'granted', unsubscribed: false, suppressed: false, erased: true }),
    ).toBe('unsubscribed');
    expect(
      subscriptionStatus({ consent: 'withdrawn', unsubscribed: false, suppressed: false, erased: false }),
    ).toBe('unsubscribed');
    expect(subscriptionStatus({ consent: null, unsubscribed: false, suppressed: false, erased: false })).toBe(
      'none',
    );
    expect(
      subscriptionStatus({
        consent: 'unknown_legacy',
        unsubscribed: false,
        suppressed: false,
        erased: false,
      }),
    ).toBe('none');
  });

  it('list members: subscribed only in the audience; unsubscribed or archived only when already on the list', () => {
    expect(memberStatus({ status: 'subscribed', inAudience: true, linked: false })).toBe('subscribed');
    expect(memberStatus({ status: 'subscribed', inAudience: false, linked: false })).toBeNull();
    expect(memberStatus({ status: 'subscribed', inAudience: false, linked: true })).toBe('archived');
    expect(memberStatus({ status: 'unsubscribed', inAudience: true, linked: false })).toBeNull();
    expect(memberStatus({ status: 'unsubscribed', inAudience: true, linked: true })).toBe('unsubscribed');
    expect(memberStatus({ status: 'none', inAudience: true, linked: false })).toBeNull();
    expect(memberStatus({ status: 'none', inAudience: true, linked: true })).toBe('archived');
  });

  it('HubSpot contacts: created only with consent; known ones updated or opted out', () => {
    expect(hubspotContactAction({ status: 'subscribed', linked: false })).toBe('upsert');
    expect(hubspotContactAction({ status: 'unsubscribed', linked: false })).toBeNull();
    expect(hubspotContactAction({ status: 'none', linked: false })).toBeNull();
    expect(hubspotContactAction({ status: 'unsubscribed', linked: true })).toBe('opt_out');
    expect(hubspotContactAction({ status: 'none', linked: true })).toBe('update');
  });

  it('property: over random consent states, an unsubscribed contact is never pushed as a subscriber', () => {
    const next = rng(0x6d4d);
    for (let i = 0; i < 5_000; i++) {
      const facts = randomFacts(next);
      const inAudience = next() < 0.7;
      const linked = next() < 0.5;
      const status = subscriptionStatus(facts);
      const member = memberStatus({ status, inAudience, linked });
      const hubspot = hubspotContactAction({ status, linked });
      // Subscribed (or created) only with express consent and no suppression of any kind.
      if (member === 'subscribed') expect(mayReceive(facts) && inAudience).toBe(true);
      if (hubspot === 'upsert') expect(mayReceive(facts)).toBe(true);
      // Nobody new reaches a provider without being subscribed.
      if (!linked) {
        expect(member === null || member === 'subscribed').toBe(true);
        expect(hubspot === null || hubspot === 'upsert').toBe(true);
      }
      // Whoever said no and is already there gets the unsubscribe (consent propagates out).
      if (!mayReceive(facts) && facts.consent !== null && facts.consent !== 'unknown_legacy' && linked)
        expect(member).toBe('unsubscribed');
      if (status === 'unsubscribed' && linked) expect(hubspot).toBe('opt_out');
    }
  });
});

describe('recorded response samples', () => {
  it('Mailchimp members parse with their status and merge fields', () => {
    const f = fixture('mailchimp') as { members: { members: unknown[] } };
    const [unsub, cleaned] = f.members.members.map(parseMailchimpMember);
    expect(unsub).toMatchObject({
      id: '7a3c2b1f0e9d8c7b6a5f4e3d2c1b0a99',
      version: '2026-03-04T10:11:12+00:00',
      fields: {
        email_address: 'unsub.person@example.test',
        status: 'unsubscribed',
        fname: 'Unsub',
        lname: 'Person',
      },
    });
    expect(cleaned?.fields.status).toBe('cleaned');
    expect(subscriberHash('  Ada@Example.TEST ')).toBe(subscriberHash('ada@example.test'));
    expect(subscriberHash('ada@example.test')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('Klaviyo profiles parse; suppressions and unsubscribes become consent changes', () => {
    const f = fixture('klaviyo') as { profiles: { data: unknown[] } };
    const [unsub, complained] = f.profiles.data.map(parseKlaviyoProfile);
    expect(unsub?.fields).toMatchObject({
      email: 'unsub.person@example.test',
      consent_status: 'unsubscribed',
    });
    expect(complained?.fields.consent_status).toBe('complained');
    expect(klaviyoStatus({ consent: 'SUBSCRIBED', suppression: [{ reason: 'HARD_BOUNCE' }] })).toBe(
      'cleaned',
    );
    expect(klaviyoStatus({ consent: 'SUBSCRIBED', suppression: [{ reason: 'USER_SUPPRESSED' }] })).toBe(
      'unsubscribed',
    );
    expect(klaviyoStatus({ consent: 'NEVER_SUBSCRIBED', suppression: [] })).toBe('never_subscribed');
  });

  it('HubSpot contacts parse with the opt-out and the origin stamp', () => {
    const f = fixture('hubspot') as { search: { results: unknown[] } };
    const [optedOut, kept] = f.search.results.map(parseHubspotContact);
    expect(optedOut).toMatchObject({
      id: '512',
      version: '2026-03-04T10:11:12.345Z',
      origin: null,
      fields: { email: 'opted.out@example.test', hs_email_optout: 'true', company: 'Example Org' },
    });
    expect(kept?.fields.hs_email_optout).toBe('false');
  });

  it('the default pull mappings turn recorded records into consent changes', () => {
    const mc = mailchimpConnector.objects[0];
    const f = fixture('mailchimp') as { members: { members: unknown[] } };
    const rec = parseMailchimpMember(f.members.members[0]);
    if (!mc?.pull || !rec) throw new Error('no pull');
    expect(applyMapping(rec.fields, mc.pull.defaultMapping, mc.localFields)).toEqual({
      ok: true,
      values: { email: 'unsub.person@example.test', subscription: 'unsubscribed' },
    });
    const hs = hubspotConnector.objects[0];
    const h = parseHubspotContact(
      (fixture('hubspot') as { search: { results: unknown[] } }).search.results[0],
    );
    if (!hs?.pull || !h) throw new Error('no pull');
    const mapped = applyMapping(h.fields, hs.pull.defaultMapping, hs.localFields);
    expect(mapped).toMatchObject({
      ok: true,
      values: { email: 'opted.out@example.test', email_opt_out: true },
    });
  });

  it('every new connector is listed with valid default mappings and a fake', () => {
    for (const key of ['mailchimp', 'hubspot', 'klaviyo']) {
      const c = CONNECTORS.find((x) => x.key === key);
      expect(c?.fake).toBeTruthy();
      expect(c?.availability).toBe('general');
      for (const o of c?.objects ?? []) {
        if (o.pull) expect(validateMapping(o.pull.defaultMapping, o.remoteFields, o.localFields)).toEqual([]);
        if (o.push) expect(validateMapping(o.push.defaultMapping, o.localFields, o.remoteFields)).toEqual([]);
      }
    }
    expect(hubspotConnector.objects.map((o) => o.key)).toEqual([
      'contacts',
      'marketing_events',
      'event_attendance',
    ]);
    expect(klaviyoConnector.objects.map((o) => o.key)).toEqual(['members']);
  });
});

const account = (provider: { seed(): unknown }): FakeAccount => ({
  authConnectionId: 'fake_test',
  orgId: '00000000-0000-7000-8000-000000000001',
  connectionId: '00000000-0000-7000-8000-000000000002',
  providerConfigKey: 'x',
  revoked: false,
  accessToken: 't',
  refreshToken: 'r',
  tokenExpiresAt: Date.now() + 60_000,
  refreshes: 0,
  data: provider.seed(),
  failNext: [],
  log: [],
});

describe('fakes', () => {
  it('Mailchimp: a member who unsubscribed cannot be re-subscribed through the API; a replay applies once', () => {
    const a = account(mailchimpFakeProvider);
    const list = MAILCHIMP_LISTS[0].id;
    const hash = subscriberHash(MAILCHIMP_SEED_UNSUBSCRIBED);
    const put = (status: string, key: string) =>
      mailchimpFakeProvider.handle(
        a,
        {
          method: 'PUT',
          path: `/3.0/lists/${list}/members/${hash}`,
          body: { email_address: MAILCHIMP_SEED_UNSUBSCRIBED, status, status_if_new: status },
          idempotencyKey: key,
        },
        't',
      );
    expect(put('subscribed', 'k1').status).toBe(400);
    const newHash = subscriberHash('new@mc-remote.test');
    const add = () =>
      mailchimpFakeProvider.handle(
        a,
        {
          method: 'PUT',
          path: `/3.0/lists/${list}/members/${newHash}`,
          body: { email_address: 'new@mc-remote.test', status: 'subscribed', status_if_new: 'subscribed' },
          idempotencyKey: 'k2',
        },
        't',
      );
    const first = add();
    expect(add()).toEqual(first);
    mailchimpRemoteSet(a, list, 'new@mc-remote.test', 'unsubscribed');
    const page = mailchimpFakeProvider.handle(a, { method: 'GET', path: `/3.0/lists/${list}/members` }, 't');
    const statuses = (page.body as { members: { email_address: string; status: string }[] }).members.map(
      (m) => `${m.email_address}:${m.status}`,
    );
    expect(statuses).toEqual([
      `${MAILCHIMP_SEED_UNSUBSCRIBED}:unsubscribed`,
      'new@mc-remote.test:unsubscribed',
    ]);
  });

  it('Klaviyo: a hard-bounced profile stays suppressed when subscribed again', () => {
    const a = account(klaviyoFakeProvider);
    const p = klaviyoRemoteSet(a, 'KlList01', 'x@kl-remote.test', 'cleaned');
    klaviyoFakeProvider.handle(
      a,
      {
        method: 'POST',
        path: '/api/profile-subscription-bulk-create-jobs',
        body: {
          data: {
            attributes: { profiles: { data: [{ attributes: { email: 'x@kl-remote.test' } }] } },
            relationships: { list: { data: { id: 'KlList01' } } },
          },
        },
      },
      't',
    );
    const res = klaviyoFakeProvider.handle(a, { method: 'GET', path: `/api/profiles/${p.id}` }, 't');
    expect(parseKlaviyoProfile((res.body as { data: unknown }).data)?.fields.consent_status).toBe('cleaned');
  });

  it('HubSpot: the opt-out is read only; an unsubscribe sets it', () => {
    const a = account(hubspotFakeProvider);
    const created = hubspotFakeProvider.handle(
      a,
      {
        method: 'POST',
        path: '/crm/v3/objects/contacts/batch/upsert',
        body: {
          inputs: [
            {
              idProperty: 'email',
              id: 'p@hs.test',
              properties: { email: 'p@hs.test', hs_email_optout: 'true' },
            },
          ],
        },
      },
      't',
    );
    const c = parseHubspotContact((created.body as { results: unknown[] }).results[0]);
    expect(c?.fields.hs_email_optout).toBe('false');
    hubspotFakeProvider.handle(
      a,
      {
        method: 'POST',
        path: '/communication-preferences/v3/unsubscribe',
        body: { emailAddress: 'p@hs.test' },
      },
      't',
    );
    const after = hubspotFakeProvider.handle(
      a,
      { method: 'GET', path: `/crm/v3/objects/contacts/${c?.id}` },
      't',
    );
    expect(parseHubspotContact(after.body)?.fields.hs_email_optout).toBe('true');
  });
});
