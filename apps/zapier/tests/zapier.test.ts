import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ZAPIER_ACTIONS, ZAPIER_EVENT_PICKER, ZAPIER_SCOPES, ZAPIER_TRIGGERS } from '@yayatoh/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envelope,
  FAKE_EVENT_ID,
  FAKE_ORG,
  type FakeApi,
  GOOD_CODE,
  OTHER_EVENT_ID,
  startFakeApi,
} from './fake-api.ts';

/**
 * M6.4c: every trigger and action of the Zapier app through Zapier's own test harness
 * (`zapier-platform-core`'s app tester, what `zapier test` runs) against the fake /v1, plus the
 * app definition through Zapier's schema validation (what `zapier validate` runs locally).
 */

const require = createRequire(import.meta.url);
type Bundle = Record<string, unknown>;
type Tester = (method: string, bundle?: Bundle) => Promise<unknown>;
const zapier = require('zapier-platform-core') as {
  createAppTester: (app: unknown) => Tester;
  createAppHandler: (app: unknown) => (event: Record<string, unknown>) => Promise<{ results: unknown }>;
  version: string;
};
const App = require('../index.js') as {
  version: string;
  platformVersion: string;
  authentication: unknown;
  triggers: Record<string, unknown>;
  creates: Record<string, unknown>;
};
const tester = zapier.createAppTester(App);
/** Run one of the app's functions by its path in the definition (`triggers.x.operation.perform`). */
const appTester = (path: string, bundle?: Bundle) => {
  const fn = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], App);
  if (typeof fn !== 'function') throw new Error(`No function at ${path}`);
  return tester(fn as never, bundle);
};

let api: FakeApi;
const ALL = 'yy_live_zapier_all_scopes_000000000000';
const NONE = 'yy_live_zapier_events_only_00000000000';
const authData = (apiKey = ALL, org = FAKE_ORG) => ({ apiKey, org });
const zap = (id: number) => ({ zap: { id } });

beforeAll(async () => {
  api = await startFakeApi();
  api.keys.set(ALL, { org: FAKE_ORG, scopes: [...ZAPIER_SCOPES], name: 'Zapier' });
  api.keys.set(NONE, { org: FAKE_ORG, scopes: ['events:read'] });
  process.env.YAYATOH_API_URL = api.url;
});
afterAll(async () => {
  delete process.env.YAYATOH_API_URL;
  await api.close();
});

const error = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to fail');
};

describe('the app definition', () => {
  it('passes Zapier’s schema validation', async () => {
    const r = await zapier.createAppHandler(App)({ command: 'validate', bundle: {} });
    expect(r.results).toEqual([]);
    expect(App.platformVersion).toBe(zapier.version);
    expect(App.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('offers exactly the triggers and actions the console lists, with their scopes', () => {
    expect(Object.keys(App.triggers).sort()).toEqual(
      [...ZAPIER_TRIGGERS.map((t) => t.key), ZAPIER_EVENT_PICKER.key].sort(),
    );
    expect(Object.keys(App.creates).sort()).toEqual(ZAPIER_ACTIONS.map((a) => a.key).sort());
    expect([...ZAPIER_SCOPES].sort()).toEqual(
      ['attendees:write', 'checkin:scan', 'contacts:write', 'events:read', 'webhooks:subscribe'].sort(),
    );
  });
});

describe('authentication: an org API key', () => {
  it('a live key of the org passes, labelled with its name and org', async () => {
    const info = (await appTester('authentication.test', { authData: authData() })) as Record<
      string,
      unknown
    >;
    expect(info).toMatchObject({ name: 'Zapier', scopes: [...ZAPIER_SCOPES] });
    const label = await appTester('authentication.connectionLabel', {
      authData: authData(),
      inputData: info,
    });
    expect(label).toBe(`Zapier (${FAKE_ORG})`);
    const sent = api.log.at(-1);
    expect(sent).toMatchObject({ method: 'GET', path: `/v1/orgs/${FAKE_ORG}/api-key` });
  });

  it('an unknown key, or another org, fails the test', async () => {
    const bad = await error(appTester('authentication.test', { authData: authData('yy_live_nope') }));
    expect(bad.message).toMatch(/unknown, expired or revoked/);
    const other = await error(appTester('authentication.test', { authData: authData(ALL, 'someone-else') }));
    expect(other.message).toMatch(/Organization not found/);
  });
});

describe('triggers (REST hooks)', () => {
  for (const t of ZAPIER_TRIGGERS) {
    it(`${t.key}: subscribe, deliver, sample, unsubscribe`, async () => {
      const targetUrl = `https://hooks.zapier.com/hooks/standard/1/${t.key}`;
      const sub = (await appTester(`triggers.${t.key}.operation.performSubscribe`, {
        authData: authData(),
        targetUrl,
      })) as { id: string; event: string };
      expect(sub.event).toBe(t.event);
      expect(api.hooks.get(sub.id)).toEqual({ org: FAKE_ORG, url: targetUrl, event: t.event });
      expect(api.log.at(-1)?.idempotencyKey).toMatch(/^zapier-[0-9a-f]{48}$/);

      // A delivery: Yayatoh's thin message, flattened into one record.
      const message = envelope(t.event, { eventId: FAKE_EVENT_ID, extra: 1 });
      const records = (await appTester(`triggers.${t.key}.operation.perform`, {
        authData: authData(),
        cleanedRequest: message,
      })) as Record<string, unknown>[];
      expect(records).toEqual([
        { id: message.id, type: t.event, occurredAt: message.occurredAt, eventId: FAKE_EVENT_ID, extra: 1 },
      ]);

      const samples = (await appTester(`triggers.${t.key}.operation.performList`, {
        authData: authData(),
      })) as Record<string, unknown>[];
      expect(samples).toHaveLength(1);
      expect(samples[0]).toMatchObject({ type: t.event });
      // The definition's static sample has the same fields as a live one.
      const op = (App.triggers[t.key] as { operation: { sample: Record<string, unknown> } }).operation;
      expect(Object.keys(op.sample).sort()).toEqual(Object.keys(samples[0] ?? {}).sort());

      await appTester(`triggers.${t.key}.operation.performUnsubscribe`, {
        authData: authData(),
        subscribeData: sub,
      });
      expect(api.hooks.has(sub.id)).toBe(false);
    });
  }

  it('a key without the scope is told which scope is missing', async () => {
    const e = await error(
      appTester('triggers.order_paid.operation.performSubscribe', {
        authData: authData(NONE),
        targetUrl: 'https://hooks.zapier.com/hooks/standard/1/x',
      }),
    );
    expect(e.message).toMatch(/missing a scope/);
  });

  it('the event picker lists the org’s events', async () => {
    const events = (await appTester('triggers.event_list.operation.perform', {
      authData: authData(),
    })) as Record<string, unknown>[];
    expect(events).toEqual([expect.objectContaining({ id: FAKE_EVENT_ID, name: 'Spring Gala' })]);
  });
});

describe('actions on /v1', () => {
  it('create_registration: registers once; a second time is a clear conflict; unknown events fail', async () => {
    const inputData = {
      eventId: FAKE_EVENT_ID,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      labels: ['zapier'],
    };
    const r = (await appTester('creates.create_registration.operation.perform', {
      authData: authData(),
      inputData,
      meta: zap(1),
    })) as Record<string, unknown>;
    expect(r).toMatchObject({
      eventId: FAKE_EVENT_ID,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      labels: ['zapier'],
    });
    // Zapier retrying the same step replays the stored answer (same Idempotency-Key).
    const again = await appTester('creates.create_registration.operation.perform', {
      authData: authData(),
      inputData,
      meta: zap(1),
    });
    expect(again).toEqual(r);
    expect(api.registrations).toHaveLength(1);
    const conflict = await error(
      appTester('creates.create_registration.operation.perform', {
        authData: authData(),
        inputData,
        meta: zap(2),
      }),
    );
    expect(conflict.message).toMatch(/Already on the guest list/);
    const missing = await error(
      appTester('creates.create_registration.operation.perform', {
        authData: authData(),
        inputData: { ...inputData, eventId: OTHER_EVENT_ID },
        meta: zap(1),
      }),
    );
    expect(missing.message).toMatch(/Event not found/);
  });

  it('add_contact: finds an existing email instead of duplicating it', async () => {
    const first = await appTester('creates.add_contact.operation.perform', {
      authData: authData(),
      inputData: { email: 'grace@example.com', name: 'Grace Hopper' },
      meta: zap(1),
    });
    expect(first).toMatchObject({ created: true });
    const second = await appTester('creates.add_contact.operation.perform', {
      authData: authData(),
      inputData: { email: 'GRACE@example.com' },
      meta: zap(1),
    });
    expect(second).toEqual({ id: (first as { id: string }).id, created: false });
    const bad = await error(
      appTester('creates.add_contact.operation.perform', {
        authData: authData(),
        inputData: { email: 'nope' },
      }),
    );
    expect(bad.message).toMatch(/Validation failed/);
    expect(api.contacts.size).toBe(1);
  });

  it('check_in: admits once; a retry replays; another Zap gets the duplicate verdict', async () => {
    const bundle = {
      authData: authData(),
      inputData: { eventId: FAKE_EVENT_ID, code: GOOD_CODE },
      meta: zap(1),
    };
    expect(await appTester('creates.check_in.operation.perform', bundle)).toMatchObject({
      result: 'admitted',
    });
    expect(await appTester('creates.check_in.operation.perform', bundle)).toMatchObject({
      result: 'admitted',
    });
    expect(await appTester('creates.check_in.operation.perform', { ...bundle, meta: zap(2) })).toMatchObject({
      result: 'duplicate',
      firstAdmittedAt: expect.any(String),
    });
    expect(
      await appTester('creates.check_in.operation.perform', {
        ...bundle,
        inputData: { eventId: FAKE_EVENT_ID, code: 'NOPE-0000' },
      }),
    ).toMatchObject({ result: 'invalid', ticket: null });
  });

  it('every action needs its own scope', async () => {
    for (const [action, inputData] of [
      ['create_registration', { eventId: FAKE_EVENT_ID, name: 'X', email: 'x@example.com' }],
      ['add_contact', { email: 'x@example.com' }],
      ['check_in', { eventId: FAKE_EVENT_ID, code: GOOD_CODE }],
    ] as const) {
      const e = await error(
        appTester(`creates.${action}.operation.perform`, { authData: authData(NONE), inputData }),
      );
      expect(e.message, action).toMatch(/missing a scope/);
    }
  });

  it('sends the key as a bearer token and an Idempotency-Key on every write', () => {
    const writes = api.log.filter((r) => r.method === 'POST');
    expect(writes.length).toBeGreaterThan(5);
    for (const w of writes) expect(w.idempotencyKey, w.path).toMatch(/^zapier-[0-9a-f]{48}$/);
  });
});

describe('the fake answers like /v1 (contract)', () => {
  it('every response the app read has the shape apps/api/openapi.json documents', () => {
    const doc = JSON.parse(readFileSync(join(__dirname, '../../api/openapi.json'), 'utf8')) as {
      components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> };
    };
    expect([...api.responses.keys()].sort()).toEqual(
      ['ApiKeyInfo', 'Attendee', 'ContactRef', 'EventPage', 'Hook', 'HookSampleList', 'ScanVerdict'].sort(),
    );
    const check = (name: string, value: unknown) => {
      const s = doc.components.schemas[name];
      expect(s, name).toBeDefined();
      const v = value as Record<string, unknown>;
      expect(Object.keys(v).sort(), name).toEqual(Object.keys(s?.properties ?? {}).sort());
      for (const r of s?.required ?? []) expect(v, `${name}.${r}`).toHaveProperty(r);
    };
    for (const [name, value] of api.responses) {
      check(name, value);
      if (name === 'EventPage') for (const e of (value as { data: unknown[] }).data) check('Event', e);
      if (name === 'HookSampleList')
        for (const e of (value as { data: unknown[] }).data) check('HookSample', e);
    }
  });
});
