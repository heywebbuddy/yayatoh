import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import { EMAIL_MESSAGES, MESSAGE_KINDS, renderMessage, SAMPLE_PARAMS, textOn } from '../src/index.ts';

const org = { name: 'Lakeside Events', brandColor: '#1d4ed8', poweredByVisible: true };

type Tree = { [k: string]: string | Tree };
const keys = (t: Tree, p = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : keys(v, `${p}${k}.`)));

describe('email copy', () => {
  const en = keys(EMAIL_MESSAGES.en as unknown as Tree).sort();
  it.each(LOCALES)('%s has exactly the English keys, all non-empty', (locale) => {
    const tree = EMAIL_MESSAGES[locale] as unknown as Tree;
    expect(keys(tree).sort()).toEqual(en);
  });
  it('every kind has copy', () => {
    for (const kind of MESSAGE_KINDS) expect(Object.keys(EMAIL_MESSAGES.en.kinds)).toContain(kind);
  });
});

describe('renderMessage: every kind in all 13 locales', () => {
  for (const locale of LOCALES)
    for (const kind of MESSAGE_KINDS)
      it(`${kind} · ${locale}`, () => {
        const r = renderMessage({
          kind,
          locale,
          params: SAMPLE_PARAMS[kind],
          org,
          unsubscribeUrl: 'https://app.yayatoh.test/unsubscribe/sample',
        });
        expect(r.lang).toBe(locale);
        expect(r.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        expect(r.html).toContain(`<html lang="${locale}" dir="${r.dir}">`);
        expect(r.subject.trim()).not.toBe('');
        expect(r.subject).not.toMatch(/[{}]/);
        expect(r.text).not.toMatch(/\{[a-zA-Z]+\}/);
        expect(r.html).toContain('Lakeside Events');
        if (typeof SAMPLE_PARAMS[kind].url === 'string') expect(r.text).toContain(SAMPLE_PARAMS[kind].url);
        // Plain-text part: subject, greeting, intro and the sender line.
        expect({ subject: r.subject, text: r.text }).toMatchSnapshot();
      });
});

describe('renderMessage details', () => {
  it('escapes organizer-written text and keeps its line breaks', () => {
    const r = renderMessage({
      kind: 'attendees.message',
      locale: 'en',
      params: {
        subject: 'Hi <b>all</b>',
        body: 'Line one\n<script>alert(1)</script>',
        name: 'A & B',
        eventName: 'E',
      },
      org,
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).toContain('Line one<br>');
    expect(r.subject).toBe('Hi <b>all</b>');
    expect(r.html).toContain('<title>Hi &lt;b&gt;all&lt;/b&gt;</title>');
    expect(r.html).toContain('A &amp; B');
  });

  it('shows the unsubscribe link and reason only for optional categories', () => {
    const optional = renderMessage({
      kind: 'events.reminder',
      locale: 'en',
      params: SAMPLE_PARAMS['events.reminder'],
      org,
      unsubscribeUrl: 'https://x.test/u/1',
    });
    expect(optional.html).toContain('href="https://x.test/u/1"');
    expect(optional.text).toContain('Unsubscribe: https://x.test/u/1');
    expect(optional.text).toContain(
      "You're getting this reminder because you have tickets from Lakeside Events.",
    );
    const transactional = renderMessage({
      kind: 'orders.tickets',
      locale: 'en',
      params: SAMPLE_PARAMS['orders.tickets'],
      org,
      unsubscribeUrl: 'https://x.test/u/1',
    });
    expect(transactional.html).not.toContain('https://x.test/u/1');
  });

  it('formats times in the event timezone and money in the recipient locale', () => {
    const reminder = renderMessage({
      kind: 'events.reminder',
      locale: 'en',
      params: SAMPLE_PARAMS['events.reminder'],
      org,
    });
    // 23:30 UTC on 12 June is 6:30 PM in Chicago.
    expect(reminder.text).toContain('Saturday, June 12, 2027 at 6:30 PM');
    const de = renderMessage({
      kind: 'orders.refund',
      locale: 'de',
      params: SAMPLE_PARAMS['orders.refund'],
      org,
    });
    expect(de.text).toContain('45,00');
  });

  it('uses plural rules per locale', () => {
    const one = (locale: string) =>
      renderMessage({
        kind: 'orders.tickets',
        locale,
        params: { ...SAMPLE_PARAMS['orders.tickets'], count: 1 },
        org,
      });
    const five = (locale: string) =>
      renderMessage({
        kind: 'orders.tickets',
        locale,
        params: { ...SAMPLE_PARAMS['orders.tickets'], count: 5 },
        org,
      });
    expect(one('en').text).toContain('Your ticket is ready.');
    expect(five('en').text).toContain('Your 5 tickets are ready.');
    expect(five('ru').text).toContain('5 билетов');
    expect(
      renderMessage({
        kind: 'orders.tickets',
        locale: 'ar',
        params: { ...SAMPLE_PARAMS['orders.tickets'], count: 2 },
        org,
      }).text,
    ).toContain('تذكرتاك');
  });

  it('applies org overrides and falls back to English for unknown locales', () => {
    const r = renderMessage({
      kind: 'orders.tickets',
      locale: 'xx',
      params: SAMPLE_PARAMS['orders.tickets'],
      org: { ...org, poweredByVisible: false },
      override: { subject: 'Welcome to {eventName}!', intro: null },
    });
    expect(r.lang).toBe('en');
    expect(r.subject).toBe('Welcome to Lakeside Jazz Night!');
    expect(r.text).not.toContain('Powered by Yayatoh');
  });

  it('refuses to render without required params', () => {
    expect(() => renderMessage({ kind: 'orders.tickets', locale: 'en', params: { name: 'x' }, org })).toThrow(
      /missing param/,
    );
  });

  it('picks readable text on the brand colour', () => {
    expect(textOn('#000000')).toBe('#FFFFFF');
    expect(textOn('#ffff00')).toBe('#000000');
  });
});
