import type { FakeAccount, FakeProvider } from '../../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../../auth/port.ts';

/**
 * The HubSpot fake (M6.4d): CRM v3 contacts (search by `lastmodifieddate`, create, read,
 * update), the communication preferences unsubscribe, and Marketing Events (events by
 * `externalEventId`, attendance by email with `register`/`attend`/`cancel`), held in memory per
 * fake account; bodies follow `fixtures/hubspot.json`. As in HubSpot, `hs_email_optout` is read
 * only (set by an unsubscribe) and a contact can't be re-subscribed through the API.
 */

export interface HubspotContact {
  id: string;
  properties: Record<string, string | null>;
  updated: number;
}

export interface HubspotEvent {
  externalEventId: string;
  objectId: string;
  properties: Record<string, unknown>;
  attendance: Record<string, { state: 'register' | 'attend' | 'cancel'; at: number }>;
}

interface HubspotData {
  clock: number;
  seq: number;
  contacts: HubspotContact[];
  events: HubspotEvent[];
  keys: Record<string, ProviderResponse>;
}

/** A contact that exists only in HubSpot (the first pull brings it into Yayatoh, without consent). */
export const HUBSPOT_SEED_CONTACT = 'only.in.hubspot@hs-remote.test';
/** A contact who opted out in HubSpot before Yayatoh was connected. */
export const HUBSPOT_SEED_OPTED_OUT = 'opted.out@hs-remote.test';

const data = (a: FakeAccount) => a.data as HubspotData;
const tick = (d: HubspotData) => {
  d.clock += 1;
  return Date.UTC(2026, 0, 1) + d.clock * 1000;
};
const iso = (ms: number) => new Date(ms).toISOString();
const PROPS = new Set(['email', 'firstname', 'lastname', 'company', 'phone', 'yayatoh_origin']);

const view = (c: HubspotContact) => ({
  id: c.id,
  properties: {
    ...c.properties,
    hs_object_id: c.id,
    lastmodifieddate: iso(c.updated),
    hs_email_optout: c.properties.hs_email_optout ?? 'false',
  },
  createdAt: iso(Date.UTC(2026, 0, 1)),
  updatedAt: iso(c.updated),
  archived: false,
});

function newContact(d: HubspotData, props: Record<string, string | null>): HubspotContact {
  d.seq += 1;
  const c: HubspotContact = { id: String(1000 + d.seq), properties: { ...props }, updated: tick(d) };
  d.contacts.push(c);
  return c;
}

const byEmail = (d: HubspotData, email: string) =>
  d.contacts.find((c) => (c.properties.email ?? '').toLowerCase() === email.trim().toLowerCase());

/** Act in HubSpot (dev route and tests): the person opts out, or the organizer edits a contact. */
export function hubspotRemoteOptOut(a: FakeAccount, email: string): HubspotContact | null {
  const d = data(a);
  const c = byEmail(d, email);
  if (!c) return null;
  c.properties.hs_email_optout = 'true';
  c.properties.yayatoh_origin = null;
  c.updated = tick(d);
  return c;
}

export function hubspotRemoteEdit(a: FakeAccount, email: string, props: Record<string, string>) {
  const d = data(a);
  const c = byEmail(d, email) ?? newContact(d, { email });
  Object.assign(c.properties, props, { yayatoh_origin: null });
  c.updated = tick(d);
  return view(c);
}

export const hubspotRemoteContacts = (a: FakeAccount) => data(a).contacts.map(view);
export const hubspotRemoteEvents = (a: FakeAccount) => data(a).events;

const err = (status: number, category: string): ProviderResponse => ({
  status,
  body: { status: 'error', category, message: category },
});

export const hubspotFakeProvider: FakeProvider = {
  accountLabel: 'HubSpot (sandbox portal)',
  seed: (): HubspotData => {
    const d: HubspotData = { clock: 0, seq: 0, contacts: [], events: [], keys: {} };
    newContact(d, { email: HUBSPOT_SEED_CONTACT, firstname: 'Only', lastname: 'Hubspot', company: 'Remote Co' });
    newContact(d, { email: HUBSPOT_SEED_OPTED_OUT, firstname: 'Opted', lastname: 'Out', hs_email_optout: 'true' });
    return d;
  },
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = data(account);
    const key = req.idempotencyKey;
    if (key && req.method !== 'GET' && d.keys[key]) return d.keys[key];
    const remember = (r: ProviderResponse) => {
      if (key) d.keys[key] = r;
      return r;
    };
    if (req.method === 'POST' && req.path === '/crm/v3/objects/contacts/search') {
      const body = (req.body ?? {}) as {
        filterGroups?: { filters?: { propertyName?: string; operator?: string; value?: string }[] }[];
        limit?: number;
      };
      const since = Number(body.filterGroups?.[0]?.filters?.find((f) => f.propertyName === 'lastmodifieddate')?.value ?? 0);
      const limit = Math.min(100, Math.max(1, Number(body.limit ?? 100)));
      const changed = d.contacts.filter((c) => c.updated > since).sort((a, b) => a.updated - b.updated);
      return { status: 200, body: { total: changed.length, results: changed.slice(0, limit).map(view) } };
    }
    if (req.method === 'POST' && req.path === '/crm/v3/objects/contacts/batch/upsert') {
      const inputs = ((req.body as { inputs?: { idProperty?: unknown; id?: unknown; properties?: Record<string, unknown> }[] })
        ?.inputs ?? []);
      const results = [];
      for (const i of inputs) {
        const email = typeof i.id === 'string' ? i.id : '';
        if (i.idProperty !== 'email' || !/^[^@\s]+@[^@\s]+$/.test(email)) return err(400, 'VALIDATION_ERROR');
        const props = Object.fromEntries(
          Object.entries(i.properties ?? {})
            .filter(([k, v]) => PROPS.has(k) && (typeof v === 'string' || v === null))
            .map(([k, v]) => [k, v as string | null]),
        );
        let c = byEmail(d, email);
        if (c) {
          Object.assign(c.properties, props);
          c.updated = tick(d);
        } else c = newContact(d, { ...props, email });
        results.push(view(c));
      }
      return remember({ status: 200, body: { status: 'COMPLETE', results } });
    }
    const one = /^\/crm\/v3\/objects\/contacts(?:\/([0-9]+))?$/.exec(req.path);
    if (one) {
      const c = one[1] ? d.contacts.find((x) => x.id === one[1]) : undefined;
      if (req.method === 'GET') return c ? { status: 200, body: view(c) } : err(404, 'OBJECT_NOT_FOUND');
      const props = ((req.body as { properties?: Record<string, unknown> })?.properties ?? {}) as Record<string, unknown>;
      const clean = Object.fromEntries(
        Object.entries(props)
          .filter(([k, v]) => PROPS.has(k) && (typeof v === 'string' || v === null))
          .map(([k, v]) => [k, v as string | null]),
      );
      if (req.method === 'POST' && !one[1]) {
        const email = String(clean.email ?? '');
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return err(400, 'VALIDATION_ERROR');
        if (byEmail(d, email)) return err(409, 'CONFLICT');
        return remember({ status: 201, body: view(newContact(d, clean)) });
      }
      if (req.method === 'PATCH' && c) {
        Object.assign(c.properties, clean);
        c.updated = tick(d);
        return remember({ status: 200, body: view(c) });
      }
      return err(c ? 405 : 404, c ? 'METHOD_NOT_ALLOWED' : 'OBJECT_NOT_FOUND');
    }
    if (req.method === 'POST' && req.path === '/communication-preferences/v3/unsubscribe') {
      const email = String((req.body as { emailAddress?: unknown })?.emailAddress ?? '');
      const c = byEmail(d, email);
      if (!c) return err(404, 'OBJECT_NOT_FOUND');
      c.properties.hs_email_optout = 'true';
      c.properties.yayatoh_origin = String((req.body as { origin?: unknown })?.origin ?? '') || null;
      c.updated = tick(d);
      return remember({ status: 200, body: { recipient: email, subscriptionId: 'marketing', status: 'NOT_SUBSCRIBED' } });
    }
    const ev = /^\/marketing\/v3\/marketing-events\/events(?:\/([A-Za-z0-9_-]+))?$/.exec(req.path);
    if (ev) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (req.method === 'POST' && !ev[1]) {
        const externalEventId = String(body.externalEventId ?? '');
        if (!externalEventId || typeof body.eventName !== 'string' || !body.eventName)
          return err(400, 'VALIDATION_ERROR');
        if (d.events.some((e) => e.externalEventId === externalEventId)) return err(409, 'CONFLICT');
        d.seq += 1;
        const e: HubspotEvent = {
          externalEventId,
          objectId: String(5000 + d.seq),
          properties: { ...body, updated: tick(d) },
          attendance: {},
        };
        d.events.push(e);
        return remember({ status: 200, body: { objectId: e.objectId, ...e.properties } });
      }
      const e = d.events.find((x) => x.externalEventId === ev[1]);
      if (!e) return err(404, 'OBJECT_NOT_FOUND');
      if (req.method === 'PATCH') {
        Object.assign(e.properties, body, { updated: tick(d) });
        return remember({ status: 200, body: { objectId: e.objectId, ...e.properties } });
      }
      if (req.method === 'GET') return { status: 200, body: { objectId: e.objectId, ...e.properties } };
    }
    const att = /^\/marketing\/v3\/marketing-events\/attendance\/([A-Za-z0-9_-]+)\/(register|attend|cancel)\/email-create$/.exec(
      req.path,
    );
    if (req.method === 'POST' && att) {
      const e = d.events.find((x) => x.externalEventId === att[1]);
      if (!e) return err(404, 'OBJECT_NOT_FOUND');
      const inputs = ((req.body as { inputs?: { email?: unknown }[] })?.inputs ?? []).flatMap((i) =>
        typeof i.email === 'string' ? [i.email.toLowerCase()] : [],
      );
      const at = tick(d);
      for (const email of inputs) e.attendance[email] = { state: att[2] as 'register', at };
      return remember({
        status: 200,
        body: { results: inputs.map((email) => ({ email, vid: byEmail(d, email)?.id ?? null, at: iso(at) })) },
      });
    }
    return err(404, 'NOT_FOUND');
  },
};
