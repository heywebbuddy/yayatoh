import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AuthRef,
  CONNECTORS,
  DIGEST_EVENT_LINES,
  type DigestFacts,
  dayBounds,
  defineConnector,
  digestAmounts,
  FAKE_SLACK_CHANNELS,
  fakeAuthForConnectors,
  fakeIntegrations,
  fakeSlackMessages,
  isProviderError,
  listSlackChannels,
  localDay,
  nextDigestAt,
  ProviderError,
  postSlackMessage,
  renderSlackAlert,
  renderSlackDigest,
  renderSlackTest,
  SLACK_MESSAGES,
  slackAuthTest,
  slackConnector,
  slackFakeProvider,
  slackPiiProblems,
  slackText,
} from '../src/index.ts';

const NY = 'America/New_York';

describe('Slack digest schedule (local time, DST)', () => {
  it('is the next local occurrence of the time, never the same instant twice', () => {
    const at = nextDigestAt(new Date('2026-07-01T11:00:00Z'), '08:00', NY);
    expect(at.toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(nextDigestAt(at, '08:00', NY).toISOString()).toBe('2026-07-02T12:00:00.000Z');
    expect(nextDigestAt(new Date('2026-07-01T12:00:00.001Z'), '08:00', NY).toISOString()).toBe(
      '2026-07-02T12:00:00.000Z',
    );
  });

  it('goes out once per local day across spring forward and fall back (a missing or doubled time)', () => {
    for (const [from, time] of [
      ['2026-03-05T00:00:00Z', '02:30'], // 02:30 does not exist on 8 March in New York
      ['2026-10-29T00:00:00Z', '01:30'], // 01:30 happens twice on 1 November
      ['2026-03-05T00:00:00Z', '08:00'],
      ['2026-10-29T00:00:00Z', '23:45'],
    ] as const) {
      let t = new Date(from);
      const days: string[] = [];
      for (let i = 0; i < 8; i++) {
        t = nextDigestAt(t, time, NY);
        days.push(localDay(t, NY));
      }
      expect(new Set(days).size).toBe(8);
      const first = days[0] as string;
      for (let i = 1; i < days.length; i++) {
        const d = new Date(`${first}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        expect(days[i]).toBe(d.toISOString().slice(0, 10));
      }
    }
    // The gap moves 02:30 forward to 03:30 EDT; the overlap takes the earlier 01:30 (EDT).
    expect(nextDigestAt(new Date('2026-03-08T05:00:00Z'), '02:30', NY).toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(nextDigestAt(new Date('2026-11-01T04:00:00Z'), '01:30', NY).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('spans a local day (23 or 25 hours around DST)', () => {
    const spring = dayBounds('2026-03-08', NY);
    expect((spring.to.getTime() - spring.from.getTime()) / 3_600_000).toBe(23);
    const fall = dayBounds('2026-11-01', NY);
    expect((fall.to.getTime() - fall.from.getTime()) / 3_600_000).toBe(25);
    expect(() => nextDigestAt(new Date(), '8am', NY)).toThrow(/HH:MM/);
  });
});

const facts = (over: Partial<DigestFacts> = {}): DigestFacts => ({
  orgName: 'Lakeside Events',
  day: '2026-10-02',
  totals: { orders: 12, tickets: 30, gross: [{ currency: 'USD', minor: 123_450 }] },
  events: [
    { name: 'Jazz Night', tickets: 20, gross: [{ currency: 'USD', minor: 100_000 }] },
    { name: 'Gala <!channel>', tickets: 10, gross: [{ currency: 'USD', minor: 23_450 }] },
  ],
  checkins: 42,
  today: [{ name: 'Morning Run', startsAt: new Date('2026-10-03T13:00:00Z'), timeZone: NY }],
  url: 'https://app.yayatoh.test/o/lakeside',
  ...over,
});

describe('Slack messages render from fixtures', () => {
  it('an alert in the words of its email, escaped, with a link to the page that fixes it', () => {
    const m = renderSlackAlert({
      locale: 'en',
      orgName: 'Lakeside Events',
      rule: 'paymentsFailed',
      severity: 'critical',
      count: 3,
      eventName: 'Jazz <Night> & Co',
      url: 'https://app.yayatoh.test/o/lakeside/events/jazz/orders',
    });
    const text = slackText(m);
    expect(m.text).toBe('Critical: Three payments failed (Jazz <Night> & Co)');
    expect(text).toContain('*Three payments failed*');
    expect(text).toContain('Critical · Jazz &lt;Night&gt; &amp; Co');
    expect(text).toContain('<https://app.yayatoh.test/o/lakeside/events/jazz/orders|Open in Yayatoh>');
    expect(slackPiiProblems(m)).toEqual([]);
  });

  it('never links anything but https (a dev origin gets the label only)', () => {
    const m = renderSlackTest({ locale: 'en', orgName: 'Lakeside', url: 'http://localhost:3000/x' });
    expect(slackText(m)).not.toContain('<http');
    expect(slackText(m)).toContain('Open in Yayatoh');
    expect(m.text).toBe('Test alert from Lakeside');
  });

  it('the digest: counts and event names, amounts only with finance, mentions escaped', () => {
    const f = facts();
    const plain = renderSlackDigest(f, { locale: 'en', includeFinance: false });
    const text = slackText(plain);
    expect(text).toContain('Daily digest · Lakeside Events');
    expect(text).toContain('Friday, October 2, 2026');
    expect(text).toContain('12 new orders · 30 tickets');
    expect(text).toContain('42 check-ins');
    expect(text).toContain('• Jazz Night: 20 tickets');
    expect(text).toContain('• Gala &lt;!channel&gt;: 10 tickets');
    expect(text).not.toContain('<!channel>');
    expect(text).toContain('• Morning Run · 9:00 AM');
    for (const a of digestAmounts(f, 'en')) expect(text).not.toContain(a);
    expect(slackPiiProblems(plain, { amounts: digestAmounts(f, 'en') })).toEqual([]);

    const finance = renderSlackDigest(f, { locale: 'en', includeFinance: true });
    expect(slackText(finance)).toContain('Revenue: $1,234.50');
    expect(slackText(finance)).toContain('• Jazz Night: 20 tickets · $1,000.00');
    // The guard catches amounts in a message that must not have them.
    expect(slackPiiProblems(finance, { amounts: digestAmounts(f, 'en') })).toEqual(['amount']);
  });

  it('an empty day, many events, and every locale (Arabic plurals, RTL text)', () => {
    const empty = renderSlackDigest(
      facts({ totals: { orders: 0, tickets: 0, gross: [] }, events: [], checkins: 0, today: [] }),
      { locale: 'en', includeFinance: true },
    );
    expect(slackText(empty)).toContain('No new orders · 0 tickets');
    expect(slackText(empty)).toContain('No check-ins');
    expect(slackText(empty)).toContain('No events today.');
    expect(slackText(empty)).not.toContain('Revenue');
    const many = Array.from({ length: DIGEST_EVENT_LINES + 2 }, (_, i) => ({
      name: `Event ${i + 1}`,
      tickets: 10 - i,
      gross: [],
    }));
    expect(
      slackText(renderSlackDigest(facts({ events: many }), { locale: 'en', includeFinance: false })),
    ).toContain('And 2 more events');
    for (const locale of LOCALES) {
      expect(Object.keys(SLACK_MESSAGES[locale]).sort()).toEqual(Object.keys(SLACK_MESSAGES.en).sort());
      const m = renderSlackDigest(facts(), { locale, includeFinance: false });
      expect(m.blocks.length).toBeGreaterThan(3);
      expect(slackPiiProblems(m, { amounts: digestAmounts(facts(), locale) })).toEqual([]);
      renderSlackAlert({
        locale,
        orgName: 'X',
        rule: 'sellOut',
        severity: 'info',
        count: 90,
        eventName: null,
        url: '',
      });
    }
    expect(slackText(renderSlackDigest(facts(), { locale: 'ar', includeFinance: false }))).toContain(
      'الملخص اليومي',
    );
  });

  it('the guard finds email addresses and phone numbers', () => {
    const m = (text: string) => ({ text, blocks: [] });
    expect(slackPiiProblems(m('Ada ada@example.com'))).toEqual(['email']);
    expect(slackPiiProblems(m('Call +1 (555) 010-2000'))).toEqual(['phone']);
    expect(slackPiiProblems(m('Day 2026-10-03, 1,234 tickets, 42 check-ins'))).toEqual([]);
  });
});

const orgId = '01999999-0000-7000-8000-0000000000c4';

describe('Slack through the port (fake Slack API)', () => {
  const auth = fakeAuthForConnectors();
  const connect = (): AuthRef => {
    const connectionId = crypto.randomUUID();
    const authConnectionId = fakeIntegrations.approve(
      { orgId, connectionId, providerConfigKey: 'slack' },
      slackFakeProvider,
    );
    return { orgId, connectionId, providerConfigKey: 'slack', authConnectionId };
  };

  it('is a general, notifications-only connector with a health check', async () => {
    expect(CONNECTORS).toContain(slackConnector);
    expect(slackConnector.objects).toEqual([]);
    expect(slackConnector.availability).toBe('general');
    expect(() => defineConnector({ ...slackConnector, purpose: 'sync', objects: [] })).toThrow(/no objects/);
    const ref = connect();
    await expect(slackAuthTest(auth.client(ref))).resolves.toBeUndefined();
    fakeIntegrations.revokeAtProvider(ref.authConnectionId);
    const err = await slackAuthTest(auth.client(ref)).catch((e: unknown) => e);
    expect(isProviderError(err) && err.auth).toBe(true);
  });

  it('lists live channels across pages, sorted, archived ones left out', async () => {
    const channels = await listSlackChannels(auth.client(connect()));
    expect(channels.map((c) => c.name)).toEqual(['door-team', 'event-ops', 'finance', 'general']);
    expect(channels.find((c) => c.name === 'finance')).toMatchObject({ isPrivate: true, isMember: true });
    expect(channels.find((c) => c.name === 'door-team')?.isMember).toBe(false);
    expect(FAKE_SLACK_CHANNELS.some((c) => c.is_archived)).toBe(true);
  });

  it('posts, and turns Slack refusals into codes (auth ones mean revoked)', async () => {
    const ref = connect();
    const client = auth.client(ref);
    const msg = renderSlackTest({ locale: 'en', orgName: 'Lakeside', url: '' });
    const { ts } = await postSlackMessage(client, 'C01GENERAL', msg, 'key-1');
    expect(ts).toMatch(/^\d+\.\d+$/);
    const account = fakeIntegrations.account(ref.authConnectionId);
    if (!account) throw new Error('account');
    expect(fakeSlackMessages(account)).toEqual([
      expect.objectContaining({ channel: 'C01GENERAL', ts, text: 'Test alert from Lakeside' }),
    ]);
    for (const [channel, code] of [
      ['C03DOORS', 'not_in_channel'],
      ['C05OLD', 'channel_not_found'],
      ['C99NOPE', 'channel_not_found'],
    ] as const) {
      const e = await postSlackMessage(client, channel, msg, 'k').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe(code);
      expect((e as ProviderError).auth).toBe(false);
    }
    fakeIntegrations.failNext(ref.authConnectionId, 503);
    const outage = await postSlackMessage(client, 'C01GENERAL', msg, 'k').catch((x: unknown) => x);
    expect((outage as ProviderError).retryable).toBe(true);
  });
});
