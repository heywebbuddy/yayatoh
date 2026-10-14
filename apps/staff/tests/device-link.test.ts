import { scrubEvent, scrubText } from '@yayatoh/mobile-core';
import { enrolmentFromLink, looksLikeEnrolmentLink, redactEnrolment } from '../src/device/link';
import { EVENT_ID, enrolLink, OTHER_TOKEN, TOKEN } from './helpers/fake-door';

describe('enrolment links', () => {
  it('reads the event and the key from the fragment of the QR link', () => {
    expect(enrolmentFromLink(enrolLink())).toEqual({ eventId: EVENT_ID, token: TOKEN });
  });

  it('accepts a tenant host, a locale prefix, a custom host and the app scheme', () => {
    for (const link of [
      enrolLink(TOKEN, EVENT_ID, 'summit.yayatoh.events'),
      `https://app.yayatoh.com/fr/scan#e=${EVENT_ID}&k=${TOKEN}`,
      `https://scan.example.org/scan/#e=${EVENT_ID}&k=${TOKEN}`,
      `yayatoh-staff://scan#e=${EVENT_ID}&k=${TOKEN}`,
      `  ${enrolLink()}  `,
    ])
      expect(enrolmentFromLink(link)).toEqual({ eventId: EVENT_ID, token: TOKEN });
  });

  it('refuses a key in the query string: it would reach a server log', () => {
    expect(enrolmentFromLink(`https://app.yayatoh.com/scan?e=${EVENT_ID}&k=${TOKEN}`)).toBeNull();
    expect(enrolmentFromLink(`https://app.yayatoh.com/scan?k=${TOKEN}#e=${EVENT_ID}`)).toBeNull();
  });

  it('refuses anything that is not an enrolment link', () => {
    for (const link of [
      '',
      'hello',
      TOKEN,
      `https://app.yayatoh.com/tickets#e=${EVENT_ID}&k=${TOKEN}`,
      `https://app.yayatoh.com/scan#e=${EVENT_ID}`,
      `https://app.yayatoh.com/scan#k=${TOKEN}`,
      `https://app.yayatoh.com/scan#e=not-a-uuid&k=${TOKEN}`,
      `https://app.yayatoh.com/scan#e=${EVENT_ID}&k=yyd_short`,
      `https://app.yayatoh.com/scan#e=${EVENT_ID}&k=ya_${TOKEN.slice(4)}`,
      `https://app.yayatoh.com/scan#e=${EVENT_ID}&k=${'x'.repeat(2000)}`,
      `javascript:alert(1)//scan#e=${EVENT_ID}&k=${TOKEN}`,
    ])
      expect(enrolmentFromLink(link)).toBeNull();
  });

  it('recognises a system link meant for enrolment, and only that path', () => {
    for (const link of [
      enrolLink(),
      'https://app.yayatoh.com/scan',
      'https://summit.yayatoh.events/fr/scan?x=1',
      'yayatoh-staff://scan#e=1',
      'yayatoh-staff-preview://scan',
      '/scan#e=1&k=2',
      '/fr/scan',
    ])
      expect(looksLikeEnrolmentLink(link)).toBe(true);
    for (const link of [
      'https://app.yayatoh.com/tickets/1',
      'https://app.yayatoh.com/tools/scan',
      'https://app.yayatoh.com/scanner',
      'yayatoh-staff://tools/scan',
      '/tools/scan',
      '/scanner',
      '',
    ])
      expect(looksLikeEnrolmentLink(link)).toBe(false);
  });
});

describe('redaction (the key never reaches a log or a crash report)', () => {
  it('masks the key and the event in a link', () => {
    const text = redactEnrolment(`opened ${enrolLink()} now`);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(EVENT_ID);
    expect(text).toContain('k=[key]');
  });

  it('masks a bare device token', () => {
    expect(redactEnrolment(`failed for ${OTHER_TOKEN}`)).toBe('failed for [token]');
  });

  it("is also what the app's crash scrubber does with the key", () => {
    expect(scrubText(`could not open ${enrolLink()}`)).not.toContain(TOKEN);
    const event = scrubEvent({
      message: `bad link ${enrolLink()}`,
      request: { url: enrolLink(), headers: { authorization: `Bearer ${TOKEN}` } },
      exception: { values: [{ type: 'Error', value: `k=${TOKEN}` }] },
      breadcrumbs: [{ message: `navigate ${enrolLink()}`, data: { url: enrolLink() } }],
      extra: { token: TOKEN, key: TOKEN },
    });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
    expect(JSON.stringify(event)).not.toContain('yyd_');
  });
});

describe('only the enrolment path counts', () => {
  it('does not take a key from another path of an app-scheme link', () => {
    expect(enrolmentFromLink(`yayatoh-staff://tools/scan#e=${EVENT_ID}&k=${TOKEN}`)).toBeNull();
    expect(enrolmentFromLink(`https://app.yayatoh.com/tools/scan#e=${EVENT_ID}&k=${TOKEN}`)).toBeNull();
  });
});
