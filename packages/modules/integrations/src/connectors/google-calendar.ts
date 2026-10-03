import type { TenantTx } from '@yayatoh/db';
import { type EventDto, findEventTx } from '@yayatoh/events';
import { type CalendarSession, calendarSessionsByIdTx, calendarSessionsPageTx } from '@yayatoh/program';
import { calendarScheduleTx } from '@yayatoh/registration';
import type { FakeAccount, FakeProvider } from '../auth/fake.ts';
import { isProviderError, type ProviderRequest, type ProviderResponse } from '../auth/port.ts';
import {
  CALENDAR_EVENT_STATUSES,
  CALENDAR_LOOKBACK_MS,
  calendarDescription,
  isTimeZone,
  zonedDateTime,
} from '../domain/calendar.ts';
import type { FieldSpec, MappingRule } from '../domain/mapping.ts';
import { sha256 } from '../hash.ts';
import {
  type ConnectorDefinition,
  defineConnector,
  type LocalRecord,
  type Page,
  type PushScope,
  type PushSide,
  type SyncIO,
} from '../sdk/connector.ts';

/**
 * Google Calendar push (M6.5c). Two connectors share one provider API (Google Calendar v3 through
 * the `IntegrationAuth` port; the fake below in dev and CI):
 *
 * - `google_calendar`: the org's calendar, made in the console by an admin. Every placed session
 *   of the org's live events (not cancelled or archived) is an entry.
 * - `google_calendar_personal`: a registrant's own calendar, opted into from their schedule page
 *   (no account). Their schedule's sessions (included plus enrolled) are entries.
 *
 * Push only, by full reconciliation: each run lists what should be on the calendar; an entry whose
 * content hash is unchanged is skipped (no provider call), a moved or renamed session is one `PUT`
 * (its `Idempotency-Key` is per connection, session and content: a retried send applies once), a
 * session that is gone (deleted, made a draft, its event cancelled, or no longer in the schedule)
 * is one `DELETE`. Entries are created under a stable id derived from the connection and session,
 * so a create retried after a lost answer finds its entry (`409`) instead of making a second one.
 * Times are wall-clock times in the event's IANA time zone with that zone named (`start.timeZone`).
 */

export const CALENDAR_ID = 'primary';
const EVENTS_PATH = `/calendar/v3/calendars/${CALENDAR_ID}/events`;

/* ----------------------------------------------------------------- the fake Google API ---- */

/** One entry at the fake calendar (the parts of a Google Calendar event we write). */
export interface FakeCalendarEvent {
  id: string;
  status: 'confirmed' | 'cancelled';
  etag: string;
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  /** Our origin stamp and record (Google's `extendedProperties.private`). */
  privateProps: Record<string, string>;
  updated: string;
  /** How many writes (insert, update) the entry has had. */
  writes: number;
}

interface FakeCalendarData {
  seq: number;
  events: FakeCalendarEvent[];
  /** Idempotency-Key → the write's answer. */
  keys: Record<string, { status: number; body: unknown }>;
}

const calData = (a: FakeAccount) => a.data as FakeCalendarData;

const eventView = (e: FakeCalendarEvent) => ({
  id: e.id,
  status: e.status,
  etag: e.etag,
  summary: e.summary,
  description: e.description,
  location: e.location,
  start: e.start,
  end: e.end,
  extendedProperties: { private: e.privateProps },
  updated: e.updated,
});

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

/** Validate an event body like Google does (the parts we send); null when it is acceptable. */
function invalidBody(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.summary !== 'string' || b.summary.length === 0) return 'summary';
  for (const k of ['start', 'end'] as const) {
    const t = b[k] as { dateTime?: unknown; timeZone?: unknown } | undefined;
    if (!t || typeof t.dateTime !== 'string' || !DATE_TIME.test(t.dateTime)) return k;
    if (typeof t.timeZone !== 'string' || !isTimeZone(t.timeZone)) return k;
  }
  const start = new Date((b.start as { dateTime: string }).dateTime).getTime();
  const end = new Date((b.end as { dateTime: string }).dateTime).getTime();
  if (!(end > start)) return 'end';
  return null;
}

function applyBody(e: FakeCalendarEvent, body: Record<string, unknown>, d: FakeCalendarData) {
  d.seq += 1;
  const props = (body.extendedProperties as { private?: Record<string, unknown> } | undefined)?.private ?? {};
  e.status = 'confirmed';
  e.summary = String(body.summary);
  e.description = typeof body.description === 'string' ? body.description : '';
  e.location = typeof body.location === 'string' ? body.location : '';
  e.start = { ...(body.start as FakeCalendarEvent['start']) };
  e.end = { ...(body.end as FakeCalendarEvent['end']) };
  e.privateProps = Object.fromEntries(
    Object.entries(props)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => [k, String(v).slice(0, 200)]),
  );
  e.etag = `"${d.seq}"`;
  e.updated = new Date().toISOString();
  e.writes += 1;
}

export const googleCalendarFakeProvider: FakeProvider = {
  accountLabel: 'Google Calendar (sandbox)',
  seed: (): FakeCalendarData => ({ seq: 0, events: [], keys: {} }),
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = calData(account);
    const m = /^\/calendar\/v3\/calendars\/primary\/events(?:\/([a-v0-9]{5,1024}))?$/.exec(req.path);
    if (!m) return { status: 404, body: { error: { code: 404, message: 'Not Found' } } };
    const id = m[1];
    const key = req.idempotencyKey;
    const remember = (res: ProviderResponse) => {
      if (key && res.status < 300) d.keys[key] = { status: res.status, body: res.body };
      return res;
    };
    if (key && d.keys[key]) return d.keys[key] as ProviderResponse;
    const found = id ? d.events.find((e) => e.id === id) : undefined;
    if (req.method === 'GET' && !id)
      return {
        status: 200,
        body: { items: d.events.filter((e) => e.status !== 'cancelled').map(eventView) },
      };
    if (req.method === 'GET')
      return found
        ? { status: 200, body: eventView(found) }
        : { status: 404, body: { error: { code: 404 } } };
    if (req.method === 'POST' && !id) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const bad = invalidBody(body);
      if (bad) return { status: 400, body: { error: { code: 400, message: `Invalid ${bad}` } } };
      const wanted = typeof body.id === 'string' ? body.id : null;
      if (wanted && !/^[a-v0-9]{5,1024}$/.test(wanted))
        return { status: 400, body: { error: { code: 400, message: 'Invalid resource id value.' } } };
      if (wanted && d.events.some((e) => e.id === wanted))
        return {
          status: 409,
          body: { error: { code: 409, message: 'The requested identifier already exists.' } },
        };
      const e: FakeCalendarEvent = {
        id: wanted ?? sha256(`${account.authConnectionId}|${d.seq}|${Math.random()}`).slice(0, 26),
        status: 'confirmed',
        etag: '',
        summary: '',
        description: '',
        location: '',
        start: { dateTime: '', timeZone: '' },
        end: { dateTime: '', timeZone: '' },
        privateProps: {},
        updated: '',
        writes: 0,
      };
      applyBody(e, body, d);
      d.events.push(e);
      return remember({ status: 200, body: eventView(e) });
    }
    if (req.method === 'PUT' && id) {
      if (!found) return { status: 404, body: { error: { code: 404, message: 'Not Found' } } };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const bad = invalidBody(body);
      if (bad) return { status: 400, body: { error: { code: 400, message: `Invalid ${bad}` } } };
      applyBody(found, body, d);
      return remember({ status: 200, body: eventView(found) });
    }
    if (req.method === 'DELETE' && id) {
      if (!found) return { status: 404, body: { error: { code: 404, message: 'Not Found' } } };
      if (found.status === 'cancelled')
        return { status: 410, body: { error: { code: 410, message: 'Resource has been deleted' } } };
      d.seq += 1;
      found.status = 'cancelled';
      found.etag = `"${d.seq}"`;
      found.updated = new Date().toISOString();
      return remember({ status: 204, body: null });
    }
    return { status: 405, body: { error: { code: 405 } } };
  },
};

/** The fake calendar's live entries (dev route and tests). */
export const fakeCalendarEvents = (a: FakeAccount) =>
  calData(a)
    .events.filter((e) => e.status === 'confirmed')
    .map((e) => ({ ...eventView(e), writes: e.writes }));

/** Every entry the fake calendar ever had, deleted ones included (tests). */
export const fakeCalendarAllEvents = (a: FakeAccount) =>
  calData(a).events.map((e) => ({ ...eventView(e), writes: e.writes }));

/* ------------------------------------------------------------------------ the connector ---- */

const remoteFields: readonly FieldSpec[] = [
  { key: 'summary', label: 'summary', type: 'string', required: true },
  { key: 'description', label: 'description', type: 'string' },
  { key: 'location', label: 'location', type: 'string' },
  { key: 'start', label: 'start.dateTime', type: 'date', required: true },
  { key: 'end', label: 'end.dateTime', type: 'date', required: true },
  { key: 'time_zone', label: 'start.timeZone', type: 'string', required: true },
];

const localFields: readonly FieldSpec[] = [
  { key: 'title', label: 'title', type: 'string', required: true },
  { key: 'description', label: 'description', type: 'string' },
  { key: 'event_name', label: 'event_name', type: 'string' },
  { key: 'room', label: 'room', type: 'string' },
  { key: 'starts_at', label: 'starts_at', type: 'date', required: true },
  { key: 'ends_at', label: 'ends_at', type: 'date', required: true },
  { key: 'time_zone', label: 'time_zone', type: 'string', required: true },
];

const defaultMapping: readonly MappingRule[] = [
  { source: 'title', target: 'summary', transform: 'none', default: null },
  { source: 'description', target: 'description', transform: 'none', default: null },
  { source: 'room', target: 'location', transform: 'none', default: null },
  { source: 'starts_at', target: 'start', transform: 'none', default: null },
  { source: 'ends_at', target: 'end', transform: 'none', default: null },
  { source: 'time_zone', target: 'time_zone', transform: 'none', default: null },
];

type LiveEvent = Pick<EventDto, 'id' | 'name' | 'timezone' | 'status'>;

/** The events a page's sessions belong to, live ones only (cancelled and archived come off). */
async function liveEventsTx(tx: TenantTx, ids: Iterable<string>): Promise<Map<string, LiveEvent>> {
  const out = new Map<string, LiveEvent>();
  for (const id of new Set(ids)) {
    const ev = await findEventTx(tx, id);
    if (ev && (CALENDAR_EVENT_STATUSES as readonly string[]).includes(ev.status)) out.set(id, ev);
  }
  return out;
}

const toLocal = (s: CalendarSession, ev: LiveEvent): LocalRecord => ({
  id: s.sessionId,
  updatedAt: s.updatedAt,
  fields: {
    title: s.title,
    description: calendarDescription(s.description),
    event_name: ev.name,
    room: s.roomName,
    starts_at: s.startsAt.toISOString(),
    ends_at: s.endsAt.toISOString(),
    time_zone: ev.timezone,
  },
});

async function recordsOf(tx: TenantTx, list: readonly CalendarSession[]): Promise<LocalRecord[]> {
  const events = await liveEventsTx(
    tx,
    list.map((s) => s.eventId),
  );
  return list.flatMap((s) => {
    const ev = events.get(s.eventId);
    return ev ? [toLocal(s, ev)] : [];
  });
}

/** The org calendar: every placed session of the org's live events, by session id. */
const orgSessions: Pick<PushSide, 'changes' | 'read'> = {
  async changes(tx, cursor, limit, scope): Promise<Page<LocalRecord>> {
    const page = await calendarSessionsPageTx(tx, {
      afterId: cursor || null,
      limit,
      endsAfter: new Date(scope.now.getTime() - CALENDAR_LOOKBACK_MS),
    });
    return {
      records: await recordsOf(tx, page.sessions),
      cursor: page.sessions[page.sessions.length - 1]?.sessionId ?? null,
      hasMore: page.hasMore,
    };
  },
  async read(tx, localId) {
    return (await recordsOf(tx, await calendarSessionsByIdTx(tx, [localId])))[0] ?? null;
  },
};

/** The registrant's schedule (theirs only: the connection's scope names them). */
async function scheduleRecordsTx(tx: TenantTx, scope: PushScope): Promise<LocalRecord[]> {
  if (!scope.registrantId) return [];
  const schedule = await calendarScheduleTx(tx, scope.registrantId);
  if (!schedule || schedule.eventId !== scope.eventId) return [];
  const list = await calendarSessionsByIdTx(tx, schedule.sessionIds);
  return (await recordsOf(tx, list)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const personalSessions: Pick<PushSide, 'changes' | 'read'> = {
  async changes(tx, cursor, limit, scope) {
    const all = (await scheduleRecordsTx(tx, scope)).filter((r) => !cursor || r.id > cursor);
    const records = all.slice(0, limit);
    return {
      records,
      cursor: records[records.length - 1]?.id ?? null,
      hasMore: all.length > limit,
    };
  },
  async read(tx, localId, scope) {
    return (await scheduleRecordsTx(tx, scope)).find((r) => r.id === localId) ?? null;
  },
};

/** The stable Google event id for one connection's entry of one session (lowercase hex). */
export const calendarEventId = (origin: string, localId: string) =>
  sha256(`${origin}|${localId}`).slice(0, 40);

function eventBody(io: SyncIO, localId: string, values: Readonly<Record<string, unknown>>) {
  const tz = String(values.time_zone ?? '');
  if (!isTimeZone(tz)) throw new Error('invalid_time_zone');
  return {
    summary: String(values.summary ?? ''),
    description: typeof values.description === 'string' ? values.description : '',
    location: typeof values.location === 'string' ? values.location : '',
    start: { dateTime: zonedDateTime(String(values.start), tz), timeZone: tz },
    end: { dateTime: zonedDateTime(String(values.end), tz), timeZone: tz },
    // The loop-guard stamp and our record, private to this app (never shown to guests).
    extendedProperties: { private: { yayatohOrigin: io.origin, yayatohSession: localId } },
  };
}

const sent = (body: unknown) => {
  const b = body as { id?: unknown; etag?: unknown };
  if (typeof b?.id !== 'string' || typeof b.etag !== 'string')
    throw new Error('The provider answered without an id');
  return { externalId: b.id, version: b.etag };
};

function sessionsObject(side: Pick<PushSide, 'changes' | 'read'>) {
  return {
    key: 'sessions',
    remoteFields,
    localFields,
    push: {
      defaultMapping,
      reconcile: true,
      ...side,
      async send(io, input) {
        const body = eventBody(io, input.localId, input.values);
        if (input.externalId) {
          const res = await io.client.request({
            method: 'PUT',
            path: `${EVENTS_PATH}/${input.externalId}`,
            body,
            idempotencyKey: input.idempotencyKey,
          });
          return sent(res.body);
        }
        const id = calendarEventId(io.origin, input.localId);
        try {
          const res = await io.client.request({
            method: 'POST',
            path: EVENTS_PATH,
            body: { id, ...body },
            idempotencyKey: input.idempotencyKey,
          });
          return sent(res.body);
        } catch (err) {
          // Created by a send whose answer was lost: update that entry instead of making another.
          if (!isProviderError(err) || err.status !== 409) throw err;
          const res = await io.client.request({
            method: 'PUT',
            path: `${EVENTS_PATH}/${id}`,
            body,
            idempotencyKey: input.idempotencyKey,
          });
          return sent(res.body);
        }
      },
      async remove(io, input) {
        try {
          await io.client.request({
            method: 'DELETE',
            path: `${EVENTS_PATH}/${input.externalId}`,
            idempotencyKey: input.idempotencyKey,
          });
        } catch (err) {
          // Already deleted (by us before a lost answer, or by the calendar's owner): done.
          if (isProviderError(err) && (err.status === 404 || err.status === 410)) return;
          throw err;
        }
      },
    } satisfies PushSide,
  };
}

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export const googleCalendarConnector: ConnectorDefinition = defineConnector({
  key: 'google_calendar',
  name: 'Google Calendar',
  providerConfigKey: 'google_calendar',
  scopes: SCOPES,
  entitlement: 'integrations',
  availability: 'general',
  fake: googleCalendarFakeProvider,
  defaultSyncIntervalMinutes: 15,
  objects: [sessionsObject(orgSessions)],
});

export const googleCalendarPersonalConnector: ConnectorDefinition = defineConnector({
  key: 'google_calendar_personal',
  name: 'Google Calendar',
  providerConfigKey: 'google_calendar_personal',
  scopes: SCOPES,
  entitlement: 'integrations',
  availability: 'general',
  audience: 'registrant',
  fake: googleCalendarFakeProvider,
  defaultSyncIntervalMinutes: 15,
  objects: [sessionsObject(personalSessions)],
});
