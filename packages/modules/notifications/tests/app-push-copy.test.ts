import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import {
  APP_PUSH_KINDS,
  APP_REMINDER_KINDS,
  KINDS,
  planReminder,
  pushOptions,
  reminderTime,
  reminderTimeFor,
  renderMessage,
  SAMPLE_PARAMS,
} from '../src/index.ts';

const org = { name: 'Lakeside Events', brandColor: '#1d4ed8', poweredByVisible: true };

// What must never reach a lock screen (P7-8): the person's name, email, phone, an amount, a ticket
// code. Every `push.*` kind is rendered with all of them in its params, in all 13 locales.
const PERSONAL = {
  name: 'Amina Diallo',
  email: 'amina.diallo@example.test',
  phone: '+351912345678',
  amountMinor: 123456,
  currency: 'EUR',
  code: 'AB12CD',
  shortCode: 'AB12CD',
  url: 'https://app.yayatoh.test/orders/secret-token',
  fromName: 'Joao Pereira',
  toName: 'Maria Costa',
};

describe('app push copy (M7.2c)', () => {
  it('lists the eight kinds of P7-8, all push-only', () => {
    expect([...APP_PUSH_KINDS].sort()).toEqual(
      [
        'push.event-cancelled',
        'push.event-changed',
        'push.order-confirmed',
        'push.reminder-24h',
        'push.reminder-2h',
        'push.ticket-received',
        'push.transfer-accepted',
        'push.transfer-cancelled',
      ].sort(),
    );
    for (const k of APP_PUSH_KINDS) expect(KINDS[k].channels).toEqual(['push']);
  });

  for (const locale of LOCALES)
    for (const kind of APP_PUSH_KINDS)
      it(`${kind} · ${locale}: title and body carry no personal data`, () => {
        const r = renderMessage({
          kind,
          locale,
          params: { ...SAMPLE_PARAMS[kind], ...PERSONAL },
          org,
          recipientName: PERSONAL.name,
        });
        const shown = `${r.subject}\n${r.preview}`;
        expect(r.subject).toContain(String(SAMPLE_PARAMS[kind].eventName));
        expect(shown).not.toMatch(/[{}]/);
        for (const secret of [
          PERSONAL.name,
          'Amina',
          PERSONAL.email,
          PERSONAL.phone,
          PERSONAL.code,
          PERSONAL.url,
          PERSONAL.fromName,
          PERSONAL.toName,
        ])
          expect(shown).not.toContain(secret);
        expect(shown).not.toMatch(/@/);
        // No amount: no currency sign or code, and no run of digits long enough for money, a phone or a code.
        expect(shown).not.toMatch(/[€$£¥₹]|\bEUR\b|\bUSD\b/);
        expect(shown).not.toMatch(/\d{5,}/);
        expect(shown).not.toContain('123');
        // A reminder shows the start's time of day (2–4 digits), never a date with a year.
        expect(shown).not.toMatch(/20\d\d/);
      });

  it('the reminder shows the time in the event’s zone, not the phone’s', () => {
    // 01:00 UTC on 2027-06-12 is 20:00 the evening before in Chicago.
    const chicago = renderMessage({
      kind: 'push.reminder-24h',
      locale: 'en',
      params: SAMPLE_PARAMS['push.reminder-24h'],
      org,
    });
    expect(chicago.preview).toMatch(/8:00\s?PM/);
    const lisbon = renderMessage({
      kind: 'push.reminder-24h',
      locale: 'en',
      params: { ...SAMPLE_PARAMS['push.reminder-24h'], timeZone: 'Europe/Lisbon' },
      org,
    });
    expect(lisbon.preview).toMatch(/2:00\s?AM/);
  });
});

describe('reminder timing (M7.2c)', () => {
  it('has two app reminder kinds', () => {
    expect([...APP_REMINDER_KINDS]).toEqual(['push.reminder-24h', 'push.reminder-2h']);
  });

  it('the 24 h reminder is the same wall-clock time the day before, across a DST change', () => {
    // US spring forward: 2027-03-14 02:00 local. A 19:00 show on the 14th is 23 hours after 19:00 on the 13th.
    const show = new Date('2027-03-15T00:00:00Z'); // 19:00 CDT on 2027-03-14
    const at = reminderTimeFor('push.reminder-24h', show, 'America/Chicago');
    expect(at.toISOString()).toBe('2027-03-14T01:00:00.000Z'); // 19:00 CST on 2027-03-13
    expect(show.getTime() - at.getTime()).toBe(23 * 3600_000);
    expect(at.getTime()).toBe(reminderTime(show, 'America/Chicago').getTime());
    // Fall back (2027-11-07): 25 hours.
    const fall = new Date('2027-11-08T01:00:00Z'); // 19:00 CST on 2027-11-07
    const fallAt = reminderTimeFor('push.reminder-24h', fall, 'America/Chicago');
    expect(fall.getTime() - fallAt.getTime()).toBe(25 * 3600_000);
  });

  it('the 2 h reminder is two elapsed hours, even when the clocks change in between', () => {
    // 03:30 CDT on the spring-forward morning: the wall clock jumped, but it is 2 h of real time.
    const show = new Date('2027-03-14T08:30:00Z');
    const at = reminderTimeFor('push.reminder-2h', show, 'America/Chicago');
    expect(show.getTime() - at.getTime()).toBe(2 * 3600_000);
    expect(at.toISOString()).toBe('2027-03-14T06:30:00.000Z');
  });

  it('plans each kind from the event as it is now', () => {
    const now = new Date('2027-03-13T12:00:00Z');
    const target = { startsAt: new Date('2027-03-15T00:00:00Z'), timeZone: 'America/Chicago' };
    expect(planReminder(target, now, 'push.reminder-24h')).toEqual({
      sendAfter: new Date('2027-03-14T01:00:00Z'),
    });
    expect(planReminder(target, now, 'push.reminder-2h')).toEqual({
      sendAfter: new Date('2027-03-14T22:00:00Z'),
    });
    // Moved earlier so that the time has passed but the event is ahead: tell them now.
    const soon = { ...target, startsAt: new Date('2027-03-13T20:00:00Z') };
    expect(planReminder(soon, now, 'push.reminder-24h')).toEqual({ sendAfter: now });
    expect(planReminder(soon, now, 'push.reminder-2h')).toEqual({
      sendAfter: new Date('2027-03-13T18:00:00Z'),
    });
    expect(planReminder({ ...target, cancelled: true }, now, 'push.reminder-2h')).toEqual({
      cancel: 'event_cancelled',
    });
    expect(
      planReminder({ ...target, startsAt: new Date('2027-03-13T11:00:00Z') }, now, 'push.reminder-2h'),
    ).toEqual({
      cancel: 'event_started',
    });
  });

  it('a 2 h reminder is stale an hour in; changes are urgent; the 24 h one can wait', () => {
    expect(pushOptions('push.reminder-2h')).toEqual({ ttlSeconds: 3600, urgency: 'high' });
    expect(pushOptions('push.reminder-24h')).toEqual({ ttlSeconds: 12 * 3600, urgency: 'normal' });
    expect(pushOptions('push.event-cancelled').urgency).toBe('high');
  });
});
