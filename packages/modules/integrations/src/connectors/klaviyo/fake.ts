import type { FakeAccount, FakeProvider } from '../../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../../auth/port.ts';

/**
 * The Klaviyo fake (M6.4d): the JSON:API shapes the connector uses (lists, a list's profiles with
 * their email marketing subscription, profile import, subscribe/unsubscribe jobs, removing a
 * profile from a list), held in memory per fake account; bodies follow `tests/fixtures/klaviyo.json`.
 * Email consent is per profile (account-wide), as in Klaviyo; `updated` is strictly increasing.
 */

type Consent = 'SUBSCRIBED' | 'UNSUBSCRIBED' | 'NEVER_SUBSCRIBED';
type Suppression = 'HARD_BOUNCE' | 'SPAM_COMPLAINT' | 'USER_SUPPRESSED';

export interface KlaviyoProfile {
  id: string;
  email: string;
  attributes: Record<string, unknown>;
  consent: Consent;
  suppression: Suppression | null;
  updated: string;
}

interface KlaviyoData {
  clock: number;
  seq: number;
  lists: { id: string; name: string; members: string[] }[];
  profiles: KlaviyoProfile[];
  keys: Record<string, unknown>;
}

export const KLAVIYO_LISTS = [
  { id: 'KlList01', name: 'Newsletter' },
  { id: 'KlList02', name: 'VIP' },
] as const;

/** A profile that was suppressed (hard bounce) before Yayatoh was connected. */
export const KLAVIYO_SEED_BOUNCED = 'bounced.before@kl-remote.test';

const data = (a: FakeAccount) => a.data as KlaviyoData;
const tick = (d: KlaviyoData) => {
  d.clock += 1;
  return new Date(Date.UTC(2026, 0, 1) + d.clock * 1000).toISOString();
};
const view = (p: KlaviyoProfile) => ({
  type: 'profile',
  id: p.id,
  attributes: {
    email: p.email,
    ...p.attributes,
    updated: p.updated,
    subscriptions: {
      email: {
        marketing: {
          consent: p.consent,
          suppression: p.suppression ? [{ reason: p.suppression, timestamp: p.updated }] : [],
        },
      },
    },
  },
});

function profileFor(d: KlaviyoData, email: string): KlaviyoProfile {
  const norm = email.trim().toLowerCase();
  let p = d.profiles.find((x) => x.email === norm);
  if (!p) {
    d.seq += 1;
    p = { id: `01KLPROF${String(d.seq).padStart(6, '0')}`, email: norm, attributes: {}, consent: 'NEVER_SUBSCRIBED', suppression: null, updated: '' };
    d.profiles.push(p);
  }
  return p;
}

/** Act as the person or Klaviyo (dev route and tests): unsubscribe, bounce, complain. */
export function klaviyoRemoteSet(
  a: FakeAccount,
  listId: string,
  email: string,
  change: 'unsubscribed' | 'cleaned' | 'complained' | 'subscribed',
): KlaviyoProfile {
  const d = data(a);
  const p = profileFor(d, email);
  const list = d.lists.find((l) => l.id === listId);
  if (list && !list.members.includes(p.id)) list.members.push(p.id);
  if (change === 'subscribed') {
    p.consent = 'SUBSCRIBED';
    p.suppression = null;
  } else if (change === 'unsubscribed') p.consent = 'UNSUBSCRIBED';
  else p.suppression = change === 'cleaned' ? 'HARD_BOUNCE' : 'SPAM_COMPLAINT';
  p.updated = tick(d);
  return p;
}

export function klaviyoRemoteMembers(a: FakeAccount, listId: string) {
  const d = data(a);
  const ids = new Set(d.lists.find((l) => l.id === listId)?.members ?? []);
  return d.profiles.filter((p) => ids.has(p.id)).map(view);
}

const ATTRS = new Set(['first_name', 'last_name', 'phone_number', 'organization']);
const notFound = { status: 404, body: { errors: [{ status: '404', code: 'not_found' }] } };

export const klaviyoFakeProvider: FakeProvider = {
  accountLabel: 'Klaviyo (sandbox)',
  seed: (): KlaviyoData => {
    const d: KlaviyoData = {
      clock: 0,
      seq: 0,
      lists: KLAVIYO_LISTS.map((l) => ({ ...l, members: [] })),
      profiles: [],
      keys: {},
    };
    const p = profileFor(d, KLAVIYO_SEED_BOUNCED);
    p.attributes = { first_name: 'Bounced', last_name: 'Before' };
    p.consent = 'SUBSCRIBED';
    p.suppression = 'HARD_BOUNCE';
    p.updated = tick(d);
    for (const l of d.lists) l.members.push(p.id);
    return d;
  },
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = data(account);
    if (req.method === 'GET' && req.path === '/api/lists')
      return {
        status: 200,
        body: { data: d.lists.map((l) => ({ type: 'list', id: l.id, attributes: { name: l.name } })), links: { next: null } },
      };
    const listProfiles = /^\/api\/lists\/([A-Za-z0-9]+)\/profiles$/.exec(req.path);
    if (req.method === 'GET' && listProfiles) {
      const list = d.lists.find((l) => l.id === listProfiles[1]);
      if (!list) return notFound;
      const since = /^greater-than\(updated,([^)]+)\)$/.exec(req.query?.filter ?? '')?.[1] ?? '';
      const size = Math.min(100, Math.max(1, Number(req.query?.['page[size]'] ?? 100)));
      const ids = new Set(list.members);
      const changed = d.profiles
        .filter((p) => ids.has(p.id) && p.updated > since)
        .sort((a, b) => a.updated.localeCompare(b.updated));
      const page = changed.slice(0, size);
      const last = page[page.length - 1];
      return {
        status: 200,
        body: {
          data: page.map(view),
          links: {
            next:
              changed.length > page.length && last
                ? `/api/lists/${list.id}/profiles?filter=greater-than(updated,${last.updated})`
                : null,
          },
        },
      };
    }
    const one = /^\/api\/profiles\/([A-Za-z0-9]+)$/.exec(req.path);
    if (req.method === 'GET' && one) {
      const p = d.profiles.find((x) => x.id === one[1]);
      return p ? { status: 200, body: { data: view(p) } } : notFound;
    }
    const key = req.idempotencyKey;
    if (key && d.keys[key] && req.method !== 'GET') return d.keys[key] as ProviderResponse;
    const remember = (r: ProviderResponse) => {
      if (key) d.keys[key] = r;
      return r;
    };
    if (req.method === 'POST' && req.path === '/api/profile-import') {
      const a = ((req.body as { data?: { attributes?: Record<string, unknown> } })?.data?.attributes ?? {}) as Record<
        string,
        unknown
      >;
      if (typeof a.email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(a.email))
        return { status: 400, body: { errors: [{ status: '400', code: 'invalid' }] } };
      const p = profileFor(d, a.email);
      for (const [k, v] of Object.entries(a)) if (ATTRS.has(k) && v !== null && v !== undefined) p.attributes[k] = v;
      p.updated = tick(d);
      return remember({ status: 200, body: { data: view(p) } });
    }
    const job = /^\/api\/profile-subscription-bulk-(create|delete)-jobs$/.exec(req.path);
    if (req.method === 'POST' && job) {
      const body = req.body as {
        data?: {
          attributes?: { profiles?: { data?: { attributes?: { email?: unknown } }[] } };
          relationships?: { list?: { data?: { id?: unknown } } };
        };
      };
      const list = d.lists.find((l) => l.id === body?.data?.relationships?.list?.data?.id);
      if (!list) return notFound;
      for (const item of body.data?.attributes?.profiles?.data ?? []) {
        const email = item.attributes?.email;
        if (typeof email !== 'string') continue;
        const p = profileFor(d, email);
        if (job[1] === 'create') {
          // Suppressed profiles stay suppressed; Klaviyo skips them.
          if (!p.suppression) p.consent = 'SUBSCRIBED';
          if (!list.members.includes(p.id)) list.members.push(p.id);
        } else p.consent = 'UNSUBSCRIBED';
        p.updated = tick(d);
      }
      return remember({ status: 202, body: null });
    }
    const rel = /^\/api\/lists\/([A-Za-z0-9]+)\/relationships\/profiles$/.exec(req.path);
    if (req.method === 'DELETE' && rel) {
      const list = d.lists.find((l) => l.id === rel[1]);
      if (!list) return notFound;
      const ids = ((req.body as { data?: { id?: unknown }[] })?.data ?? []).map((x) => x.id);
      list.members = list.members.filter((m) => !ids.includes(m));
      return remember({ status: 204, body: null });
    }
    return { status: 405, body: { errors: [{ status: '405', code: 'method_not_allowed' }] } };
  },
};
