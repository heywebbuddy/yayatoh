import { createHash } from 'node:crypto';
import type { FakeAccount, FakeProvider } from '../../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../../auth/port.ts';

/**
 * The Mailchimp fake (M6.4d): the Marketing API v3 shapes the connector uses (lists, list
 * members by subscriber hash, archive), held in memory per fake account. Response bodies follow
 * the recorded samples in `tests/fixtures/` (the connector's parser is tested against both). Behaviour
 * that matters for consent is Mailchimp's: a member who unsubscribed can't be set back to
 * `subscribed` through the API (400, "Member In Compliance State"); archiving keeps the
 * unsubscribe. `last_changed` is strictly increasing so `since_last_changed` pages are exact.
 */

export interface MailchimpMember {
  id: string;
  email_address: string;
  status: 'subscribed' | 'unsubscribed' | 'cleaned' | 'pending' | 'archived';
  merge_fields: Record<string, unknown>;
  last_changed: string;
}

interface MailchimpData {
  clock: number;
  lists: { id: string; name: string }[];
  members: Record<string, MailchimpMember[]>;
  keys: Record<string, unknown>;
}

export const MAILCHIMP_LISTS = [
  { id: 'mc_list_main', name: 'Newsletter' },
  { id: 'mc_list_events', name: 'Event attendees' },
] as const;

/** Someone who unsubscribed in Mailchimp before Yayatoh was connected (the first pull finds them). */
export const MAILCHIMP_SEED_UNSUBSCRIBED = 'left.before@mc-remote.test';

export const subscriberHash = (email: string) =>
  createHash('md5').update(email.trim().toLowerCase()).digest('hex');

const data = (a: FakeAccount) => a.data as MailchimpData;
const tick = (d: MailchimpData) => {
  d.clock += 1;
  return new Date(Date.UTC(2026, 0, 1) + d.clock * 1000).toISOString();
};
const view = (listId: string, m: MailchimpMember) => ({
  id: m.id,
  email_address: m.email_address,
  unique_email_id: m.id.slice(0, 10),
  status: m.status,
  merge_fields: m.merge_fields,
  list_id: listId,
  last_changed: m.last_changed,
});

/** Act as the person or the organizer in Mailchimp (dev route and tests). */
export function mailchimpRemoteSet(
  a: FakeAccount,
  listId: string,
  email: string,
  status: MailchimpMember['status'],
): MailchimpMember {
  const d = data(a);
  const list = d.members[listId] ?? [];
  d.members[listId] = list;
  const id = subscriberHash(email);
  let m = list.find((x) => x.id === id);
  if (!m) {
    m = { id, email_address: email, status, merge_fields: {}, last_changed: '' };
    list.push(m);
  }
  m.status = status;
  m.last_changed = tick(d);
  return m;
}

export const mailchimpRemoteMembers = (a: FakeAccount, listId: string) =>
  (data(a).members[listId] ?? []).map((m) => view(listId, m));

const MERGE = new Set(['FNAME', 'LNAME', 'PHONE', 'COMPANY']);

export const mailchimpFakeProvider: FakeProvider = {
  accountLabel: 'Mailchimp (sandbox)',
  seed: (): MailchimpData => {
    const d: MailchimpData = {
      clock: 0,
      lists: MAILCHIMP_LISTS.map((l) => ({ ...l })),
      members: Object.fromEntries(MAILCHIMP_LISTS.map((l) => [l.id, []])),
      keys: {},
    };
    for (const l of MAILCHIMP_LISTS) {
      const list = d.members[l.id] ?? [];
      list.push({
        id: subscriberHash(MAILCHIMP_SEED_UNSUBSCRIBED),
        email_address: MAILCHIMP_SEED_UNSUBSCRIBED,
        status: 'unsubscribed',
        merge_fields: { FNAME: 'Left', LNAME: 'Before' },
        last_changed: tick(d),
      });
    }
    return d;
  },
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = data(account);
    if (req.method === 'GET' && req.path === '/3.0/lists')
      return {
        status: 200,
        body: {
          lists: d.lists.map((l) => ({
            id: l.id,
            name: l.name,
            stats: { member_count: (d.members[l.id] ?? []).filter((m) => m.status === 'subscribed').length },
          })),
          total_items: d.lists.length,
        },
      };
    const m = /^\/3\.0\/lists\/([A-Za-z0-9_]+)\/members(?:\/([0-9a-f]{32}))?$/.exec(req.path);
    if (!m?.[1]) return { status: 404, body: { title: 'Resource Not Found', status: 404 } };
    const listId = m[1];
    const list = d.members[listId];
    if (!list) return { status: 404, body: { title: 'Resource Not Found', status: 404 } };
    const hash = m[2];
    if (req.method === 'GET' && !hash) {
      const since = req.query?.since_last_changed ?? '';
      const count = Math.min(1000, Math.max(1, Number(req.query?.count ?? 100)));
      const changed = list
        .filter((x) => x.status !== 'archived' && x.last_changed > since)
        .sort((a, b) => a.last_changed.localeCompare(b.last_changed));
      return {
        status: 200,
        body: {
          members: changed.slice(0, count).map((x) => view(listId, x)),
          list_id: listId,
          total_items: changed.length,
        },
      };
    }
    const member = hash ? list.find((x) => x.id === hash) : undefined;
    if (req.method === 'GET' && hash)
      return member && member.status !== 'archived'
        ? { status: 200, body: view(listId, member) }
        : { status: 404, body: { title: 'Resource Not Found', status: 404 } };
    if (req.method === 'PUT' && hash) {
      const key = req.idempotencyKey;
      if (key && d.keys[key]) return { status: 200, body: d.keys[key] };
      const body = (req.body ?? {}) as {
        email_address?: unknown;
        status?: unknown;
        status_if_new?: unknown;
        merge_fields?: Record<string, unknown>;
      };
      const email = typeof body.email_address === 'string' ? body.email_address : '';
      if (!/^[^@\s]+@[^@\s]+$/.test(email))
        return { status: 400, body: { title: 'Invalid Resource', status: 400 } };
      const status = (
        member ? body.status : (body.status_if_new ?? body.status)
      ) as MailchimpMember['status'];
      if (!['subscribed', 'unsubscribed', 'pending'].includes(String(status ?? member?.status)))
        return { status: 400, body: { title: 'Invalid Resource', status: 400 } };
      // An unsubscribed or cleaned member can't be re-subscribed through the API.
      if (
        member &&
        status === 'subscribed' &&
        (member.status === 'unsubscribed' || member.status === 'cleaned')
      )
        return { status: 400, body: { title: 'Member In Compliance State', status: 400 } };
      const fields = Object.fromEntries(
        Object.entries(body.merge_fields ?? {}).filter(([k, v]) => MERGE.has(k) && v !== undefined),
      );
      let row = member;
      if (!row) {
        row = { id: hash, email_address: email, status, merge_fields: {}, last_changed: '' };
        list.push(row);
      }
      row.email_address = email;
      if (status) row.status = status;
      row.merge_fields = { ...row.merge_fields, ...fields };
      row.last_changed = tick(d);
      const out = view(listId, row);
      if (key) d.keys[key] = out;
      return { status: 200, body: out };
    }
    if (req.method === 'DELETE' && hash) {
      // Archive: off the list; an unsubscribe stays an unsubscribe.
      if (!member) return { status: 404, body: { title: 'Resource Not Found', status: 404 } };
      if (member.status === 'subscribed' || member.status === 'pending') member.status = 'archived';
      member.last_changed = tick(d);
      return { status: 204, body: null };
    }
    return { status: 405, body: { title: 'Method Not Allowed', status: 405 } };
  },
};
