import { createHash } from 'node:crypto';
import {
  recordZoomAttendanceTx,
  zoomRegistrantChangesTx,
  zoomRegistrantTx,
  zoomReportWebinarsTx,
} from '@yayatoh/virtual';
import type { FakeAccount, FakeProvider } from '../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../auth/port.ts';
import { isProviderError } from '../auth/port.ts';
import { defineConnector, type LocalRecord, type RemoteRecord, type SyncIO } from '../sdk/connector.ts';

/**
 * The Zoom connector (M6.9b, decision P6-9): live webinars for program sessions. Connected through
 * the `IntegrationAuth` port (Nango in production once the owner's Zoom Marketplace app is
 * approved; the fake below in dev and CI). Two objects:
 *
 * - `registrants` (push): `virtual.zoom_registrants` rows (holders with online access of a session
 *   linked to a webinar) become webinar registrants, `POST /webinars/{id}/registrants`. Exactly
 *   once: the engine's record link (one Zoom registrant per row), an `Idempotency-Key` per row and
 *   content (a retry after a lost answer is applied once), and Zoom itself keeps one registrant per
 *   address and webinar.
 * - `participants` (pull): after a session ends, its webinar's participant report
 *   (`GET /report/webinars/{id}/participants`, one segment per join → leave) becomes
 *   `virtual.zoom_attendance`, matched to the ticket registered with that address. A report pulled
 *   again changes nothing (stable record ids; the version is the segment's times).
 */

/* ------------------------------------------------------------------ the fake Zoom API ---- */

interface FakeRegistrant {
  registrant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  join_url: string;
}

interface FakeParticipant {
  id: string;
  user_email: string;
  name: string;
  join_time: string;
  leave_time: string;
  duration: number;
}

interface ZoomData {
  webinars: Record<string, { registrants: FakeRegistrant[]; participants: FakeParticipant[] }>;
  /** Idempotency-Key → the answer it got. */
  keys: Record<string, unknown>;
}

const data = (a: FakeAccount) => a.data as ZoomData;
const webinar = (a: FakeAccount, id: string) => {
  const d = data(a);
  d.webinars[id] ??= { registrants: [], participants: [] };
  return d.webinars[id];
};

/** The fake account's registrants of one webinar (dev route and tests). */
export const zoomFakeRegistrants = (a: FakeAccount, webinarId: string): readonly FakeRegistrant[] =>
  data(a).webinars[webinarId]?.registrants ?? [];

/**
 * Someone attended a webinar at the fake Zoom (dev route and tests): one join → leave segment in
 * its participant report.
 */
export function zoomFakeAttend(
  a: FakeAccount,
  webinarId: string,
  p: { email: string; name: string; joinedAt: Date; leftAt: Date },
) {
  const w = webinar(a, webinarId);
  w.participants.push({
    id: `p_${w.participants.length + 1}`,
    user_email: p.email,
    name: p.name,
    join_time: p.joinedAt.toISOString(),
    leave_time: p.leftAt.toISOString(),
    duration: Math.round((p.leftAt.getTime() - p.joinedAt.getTime()) / 1000),
  });
}

/** Report pages hold this many participants (Zoom's `page_size`; small so paging is exercised). */
export const ZOOM_REPORT_PAGE = 30;

export const zoomFakeProvider: FakeProvider = {
  accountLabel: 'Zoom (sandbox)',
  seed: (): ZoomData => ({ webinars: {}, keys: {} }),
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = data(account);
    const reg = /^\/webinars\/([0-9]{9,12})\/registrants$/.exec(req.path);
    if (reg?.[1] && req.method === 'POST') {
      const key = req.idempotencyKey;
      if (key && d.keys[key]) return { status: 201, body: d.keys[key] };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+$/.test(email) || typeof body.first_name !== 'string' || !body.first_name)
        return { status: 400, body: { code: 300, message: 'Validation Failed.' } };
      const w = webinar(account, reg[1]);
      // Zoom keeps one registrant per address: registering it again answers the same one.
      let r = w.registrants.find((x) => x.email === email);
      if (!r) {
        const registrantId = `zr_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
        r = {
          registrant_id: registrantId,
          email,
          first_name: String(body.first_name).slice(0, 64),
          last_name: typeof body.last_name === 'string' ? body.last_name.slice(0, 64) : '',
          join_url: `https://zoom.example.test/w/${reg[1]}?tk=${registrantId}`,
        };
        w.registrants.push(r);
      } else {
        r.first_name = String(body.first_name).slice(0, 64);
        r.last_name = typeof body.last_name === 'string' ? body.last_name.slice(0, 64) : '';
      }
      const out = { registrant_id: r.registrant_id, id: Number(reg[1]), join_url: r.join_url };
      if (key) d.keys[key] = out;
      return { status: 201, body: out };
    }
    const rep = /^\/report\/webinars\/([0-9]{9,12})\/participants$/.exec(req.path);
    if (rep?.[1] && req.method === 'GET') {
      const w = d.webinars[rep[1]];
      if (!w) return { status: 404, body: { code: 3001, message: 'Webinar does not exist.' } };
      const start = Number(req.query?.next_page_token || 0);
      const page = w.participants.slice(start, start + ZOOM_REPORT_PAGE);
      const next = start + page.length;
      return {
        status: 200,
        body: {
          participants: page,
          next_page_token: next < w.participants.length ? String(next) : '',
          total_records: w.participants.length,
        },
      };
    }
    return { status: 404, body: { code: 404, message: 'Not found' } };
  },
};

/* ------------------------------------------------------------------- the connector ---- */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** The pull cursor: the webinar being read and Zoom's page token (`<webinar>|<token>`). */
function parseCursor(c: string | null): { webinarId: string | null; token: string } {
  const m = c ? /^([0-9]{9,12})\|([A-Za-z0-9_-]{0,200})$/.exec(c) : null;
  return m?.[1] ? { webinarId: m[1], token: m[2] ?? '' } : { webinarId: null, token: '' };
}

function participantRecord(webinarId: string, raw: unknown): RemoteRecord | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p.join_time !== 'string' || typeof p.leave_time !== 'string') return null;
  const email = typeof p.user_email === 'string' ? p.user_email : '';
  const who = typeof p.id === 'string' ? p.id : '';
  return {
    id: `${webinarId}:${sha(`${webinarId}|${email.toLowerCase()}|${who}|${p.join_time}`).slice(0, 40)}`,
    version: sha(`${p.join_time}|${p.leave_time}|${String(p.duration ?? '')}`).slice(0, 32),
    updatedAt: null,
    origin: null,
    fields: {
      webinar_id: webinarId,
      user_email: email,
      name: typeof p.name === 'string' ? p.name : '',
      join_time: p.join_time,
      leave_time: p.leave_time,
      duration: typeof p.duration === 'number' ? p.duration : null,
    },
  };
}

async function listParticipants(io: SyncIO, cursor: string | null) {
  const webinars = await io.read((tx) => zoomReportWebinarsTx(tx, io.now));
  const pos = parseCursor(cursor);
  // A webinar unlinked since the cursor was stored: carry on with the next one.
  let i = pos.webinarId ? webinars.findIndex((w) => w >= (pos.webinarId as string)) : 0;
  if (i < 0) i = webinars.length;
  let token = pos.webinarId && webinars[i] === pos.webinarId ? pos.token : '';
  for (; i < webinars.length; i++, token = '') {
    const webinarId = webinars[i] as string;
    let body: { participants?: unknown[]; next_page_token?: unknown };
    try {
      const res = await io.client.request({
        method: 'GET',
        path: `/report/webinars/${webinarId}/participants`,
        query: { page_size: String(ZOOM_REPORT_PAGE), ...(token ? { next_page_token: token } : {}) },
      });
      body = res.body as typeof body;
    } catch (err) {
      // No report (not held, not ready yet, or another account's id): nothing to pull there.
      if (isProviderError(err) && (err.status === 404 || err.status === 400)) continue;
      throw err;
    }
    const records = (body.participants ?? [])
      .map((p) => participantRecord(webinarId, p))
      .filter((r): r is RemoteRecord => r !== null);
    const next = typeof body.next_page_token === 'string' ? body.next_page_token : '';
    const more = next !== '' || i + 1 < webinars.length;
    // The end of the last report starts the next run from the first webinar again ('').
    const cursorOut = next ? `${webinarId}|${next}` : i + 1 < webinars.length ? `${webinars[i + 1]}|` : '';
    return { records, cursor: cursorOut, hasMore: more };
  }
  return { records: [], cursor: '', hasMore: false };
}

const toLocal = (r: { id: string; updatedAt: Date; fields: Record<string, unknown> }): LocalRecord => ({
  id: r.id,
  updatedAt: r.updatedAt,
  fields: r.fields,
});

export const zoomConnector = defineConnector({
  key: 'zoom',
  name: 'Zoom',
  providerConfigKey: 'zoom',
  scopes: ['webinar:write:registrant:admin', 'report:read:list_webinar_participants:admin'],
  entitlement: 'virtual',
  availability: 'general',
  fake: zoomFakeProvider,
  objects: [
    {
      key: 'registrants',
      localFields: [
        { key: 'webinar_id', label: 'webinar_id', type: 'string', required: true },
        { key: 'email', label: 'email', type: 'email', required: true },
        { key: 'first_name', label: 'first_name', type: 'string' },
        { key: 'last_name', label: 'last_name', type: 'string' },
      ],
      remoteFields: [
        { key: 'webinar_id', label: 'webinar_id', type: 'string', required: true },
        { key: 'email', label: 'email', type: 'email', required: true },
        { key: 'first_name', label: 'first_name', type: 'string', required: true },
        { key: 'last_name', label: 'last_name', type: 'string' },
      ],
      push: {
        defaultMapping: [
          { source: 'webinar_id', target: 'webinar_id', transform: 'none', default: null },
          { source: 'email', target: 'email', transform: 'lowercase', default: null },
          { source: 'first_name', target: 'first_name', transform: 'trim', default: 'Guest' },
          { source: 'last_name', target: 'last_name', transform: 'trim', default: null },
        ],
        async changes(tx, cursor, limit) {
          const p = await zoomRegistrantChangesTx(tx, cursor, limit);
          return { records: p.records.map(toLocal), cursor: p.cursor, hasMore: p.records.length === limit };
        },
        async read(tx, localId) {
          const r = await zoomRegistrantTx(tx, localId);
          return r ? toLocal(r) : null;
        },
        async send(io, input) {
          const webinarId = String(input.values.webinar_id ?? '');
          if (!/^[0-9]{9,12}$/.test(webinarId)) throw new Error('No webinar for this registrant');
          const res = await io.client.request({
            method: 'POST',
            path: `/webinars/${webinarId}/registrants`,
            body: {
              email: input.values.email,
              first_name: input.values.first_name,
              last_name: input.values.last_name ?? '',
            },
            idempotencyKey: input.idempotencyKey,
          });
          const out = res.body as { registrant_id?: unknown };
          if (typeof out.registrant_id !== 'string') throw new Error('Zoom answered without a registrant');
          return { externalId: out.registrant_id, version: out.registrant_id };
        },
      },
    },
    {
      key: 'participants',
      remoteFields: [
        { key: 'webinar_id', label: 'webinar_id', type: 'string' },
        { key: 'user_email', label: 'user_email', type: 'string' },
        { key: 'name', label: 'name', type: 'string' },
        { key: 'join_time', label: 'join_time', type: 'string' },
        { key: 'leave_time', label: 'leave_time', type: 'string' },
        { key: 'duration', label: 'duration', type: 'number' },
      ],
      localFields: [
        { key: 'webinar_id', label: 'webinar_id', type: 'string', required: true },
        { key: 'email', label: 'email', type: 'string' },
        { key: 'joined_at', label: 'joined_at', type: 'date', required: true },
        { key: 'left_at', label: 'left_at', type: 'date', required: true },
      ],
      pull: {
        defaultMapping: [
          { source: 'webinar_id', target: 'webinar_id', transform: 'none', default: null },
          { source: 'user_email', target: 'email', transform: 'lowercase', default: null },
          { source: 'join_time', target: 'joined_at', transform: 'to_date', default: null },
          { source: 'leave_time', target: 'left_at', transform: 'to_date', default: null },
        ],
        list: listParticipants,
        // Report segments are never fetched one by one: a retried segment comes back with the
        // next pull of its report (null: nothing to retry now).
        async get() {
          return null;
        },
        async write(tx, ctx, values, localId) {
          return {
            localId: await recordZoomAttendanceTx(
              tx,
              ctx,
              {
                webinarId: String(values.webinar_id),
                email: typeof values.email === 'string' && values.email ? values.email : null,
                joinedAt: new Date(String(values.joined_at)),
                leftAt: new Date(String(values.left_at)),
              },
              localId,
            ),
          };
        },
      },
    },
  ],
});
