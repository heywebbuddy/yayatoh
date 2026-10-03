import { describe, expect, it } from 'vitest';
import type { FakeAccount } from '../src/auth/fake.ts';
import {
  calendarEventId,
  fakeCalendarAllEvents,
  fakeCalendarEvents,
  googleCalendarConnector,
  googleCalendarFakeProvider,
  googleCalendarPersonalConnector,
} from '../src/connectors/google-calendar.ts';
import {
  CALENDAR_EVENT_ID,
  calendarDescription,
  isTimeZone,
  MAX_CALENDAR_DESCRIPTION,
  zonedDateTime,
} from '../src/domain/calendar.ts';
import { defineConnector, type PushSide } from '../src/sdk/connector.ts';

/** M6.5c calendar rules and the fake Google Calendar API. */

describe('zonedDateTime', () => {
  it('renders the instant as wall-clock time in the event’s zone with that zone’s offset', () => {
    expect(zonedDateTime('2030-03-09T17:00:00Z', 'America/New_York')).toBe('2030-03-09T12:00:00-05:00');
    // After the DST change the offset follows.
    expect(zonedDateTime('2030-03-11T17:00:00Z', 'America/New_York')).toBe('2030-03-11T13:00:00-04:00');
    expect(zonedDateTime('2030-01-01T00:30:00Z', 'Asia/Kolkata')).toBe('2030-01-01T06:00:00+05:30');
    expect(zonedDateTime(new Date('2030-06-01T08:00:00Z'), 'UTC')).toBe('2030-06-01T08:00:00+00:00');
    expect(zonedDateTime('2030-06-01T23:30:00Z', 'Pacific/Auckland')).toBe('2030-06-02T11:30:00+12:00');
  });

  it('round-trips: the rendered time is the same instant', () => {
    for (const tz of ['America/Los_Angeles', 'Europe/Berlin', 'Australia/Lord_Howe', 'Asia/Kathmandu']) {
      const at = new Date('2030-10-05T19:45:00Z');
      expect(new Date(zonedDateTime(at, tz)).getTime()).toBe(at.getTime());
    }
  });

  it('refuses unknown zones and dates', () => {
    expect(() => zonedDateTime('2030-01-01T00:00:00Z', 'Mars/Olympus')).toThrow();
    expect(() => zonedDateTime('not a date', 'UTC')).toThrow();
    expect(isTimeZone('Europe/Paris')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});

describe('calendar entries', () => {
  it('ids are stable per connection and session, and valid Google ids', () => {
    const one = calendarEventId('yayatoh:c1', 's1');
    expect(one).toBe(calendarEventId('yayatoh:c1', 's1'));
    expect(one).not.toBe(calendarEventId('yayatoh:c2', 's1'));
    expect(one).toMatch(CALENDAR_EVENT_ID);
  });

  it('cuts long descriptions', () => {
    expect(calendarDescription('  short ')).toBe('short');
    const long = calendarDescription('x'.repeat(2000));
    expect(long).toHaveLength(MAX_CALENDAR_DESCRIPTION);
    expect(long.endsWith('…')).toBe(true);
  });

  it('the connectors: the org one is offered to the console, the personal one is the registrant’s', () => {
    expect(googleCalendarConnector.audience ?? 'org').toBe('org');
    expect(googleCalendarPersonalConnector.audience).toBe('registrant');
    for (const c of [googleCalendarConnector, googleCalendarPersonalConnector]) {
      expect(c.availability).toBe('general');
      expect(c.entitlement).toBe('integrations');
      expect(c.defaultSyncIntervalMinutes).toBe(15);
      const sessions = c.objects[0];
      expect(sessions?.push?.reconcile).toBe(true);
      expect(sessions?.pull).toBeUndefined();
    }
  });

  it('a reconciling push must be able to remove', () => {
    expect(() =>
      defineConnector({
        ...googleCalendarConnector,
        key: 'broken_calendar',
        objects: [
          {
            ...(googleCalendarConnector.objects[0] as (typeof googleCalendarConnector.objects)[number]),
            push: { ...(googleCalendarConnector.objects[0]?.push as PushSide), remove: undefined },
          },
        ],
      }),
    ).toThrow(/needs remove/);
  });
});

describe('the fake Google Calendar API', () => {
  const account = (): FakeAccount => ({
    authConnectionId: 'fake_x',
    orgId: 'o',
    connectionId: 'c',
    providerConfigKey: 'google_calendar',
    revoked: false,
    accessToken: 't',
    refreshToken: 'r',
    tokenExpiresAt: Date.now() + 60_000,
    refreshes: 0,
    data: googleCalendarFakeProvider.seed(),
    failNext: [],
    log: [],
  });
  const body = (summary: string, start = '2030-03-09T12:00:00-05:00', end = '2030-03-09T13:00:00-05:00') => ({
    summary,
    start: { dateTime: start, timeZone: 'America/New_York' },
    end: { dateTime: end, timeZone: 'America/New_York' },
  });
  const path = '/calendar/v3/calendars/primary/events';

  it('creates under a client id once (409 after), updates, deletes once (410 after)', () => {
    const a = account();
    const h = googleCalendarFakeProvider.handle;
    const created = h(a, { method: 'POST', path, body: { id: 'abc12345', ...body('Talk') } }, 't');
    expect(created.status).toBe(200);
    expect(h(a, { method: 'POST', path, body: { id: 'abc12345', ...body('Talk') } }, 't').status).toBe(409);
    expect(h(a, { method: 'POST', path, body: { id: 'XYZ', ...body('Talk') } }, 't').status).toBe(400);
    const put = h(
      a,
      {
        method: 'PUT',
        path: `${path}/abc12345`,
        body: body('Talk moved', '2030-03-09T14:00:00-05:00', '2030-03-09T15:00:00-05:00'),
      },
      't',
    );
    expect(put.status).toBe(200);
    expect(fakeCalendarEvents(a)[0]).toMatchObject({ summary: 'Talk moved', writes: 2 });
    expect(h(a, { method: 'DELETE', path: `${path}/abc12345` }, 't').status).toBe(204);
    expect(h(a, { method: 'DELETE', path: `${path}/abc12345` }, 't').status).toBe(410);
    expect(fakeCalendarEvents(a)).toEqual([]);
    expect(fakeCalendarAllEvents(a)[0]?.status).toBe('cancelled');
  });

  it('refuses what Google refuses: no summary, bad times or zones, end before start', () => {
    const a = account();
    const h = googleCalendarFakeProvider.handle;
    expect(h(a, { method: 'POST', path, body: { ...body('x'), summary: '' } }, 't').status).toBe(400);
    expect(h(a, { method: 'POST', path, body: body('x', '2030-03-09 12:00') }, 't').status).toBe(400);
    expect(
      h(
        a,
        {
          method: 'POST',
          path,
          body: { ...body('x'), start: { dateTime: '2030-03-09T12:00:00Z', timeZone: 'Nope/Nope' } },
        },
        't',
      ).status,
    ).toBe(400);
    expect(
      h(a, { method: 'POST', path, body: body('x', '2030-03-09T14:00:00Z', '2030-03-09T13:00:00Z') }, 't')
        .status,
    ).toBe(400);
  });

  it('applies a write with the same Idempotency-Key once', () => {
    const a = account();
    const h = googleCalendarFakeProvider.handle;
    h(a, { method: 'POST', path, body: { id: 'abc12345', ...body('Talk') } }, 't');
    const req = {
      method: 'PUT' as const,
      path: `${path}/abc12345`,
      body: body('Again'),
      idempotencyKey: 'yy-key-1',
    };
    expect(h(a, req, 't').status).toBe(200);
    expect(h(a, req, 't').status).toBe(200);
    expect(fakeCalendarEvents(a)[0]?.writes).toBe(2);
  });
});
