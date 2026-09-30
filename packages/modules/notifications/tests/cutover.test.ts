import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import {
  CUTOVER_AUDIENCES,
  CUTOVER_MOMENTS,
  EMAIL_MESSAGES,
  renderCutoverNotice,
  renderCutoverSet,
} from '../src/index.ts';

const base = {
  start: new Date('2026-11-04T07:00:00Z'),
  end: new Date('2026-11-04T07:45:00Z'),
  timeZone: 'America/New_York',
  statusUrl: 'https://status.yayatoh.com/',
};

/** ICU argument names in a message ({start}, {end}). */
const args = (m: string) => [...m.matchAll(/\{(\w+)/g)].map((x) => x[1]).sort();

describe('cutover notices (M2.5a)', () => {
  it('renders every moment × audience × locale with the times filled in', () => {
    const set = renderCutoverSet(base);
    expect(set).toHaveLength(CUTOVER_MOMENTS.length * CUTOVER_AUDIENCES.length * LOCALES.length);
    for (const { message, locale, moment } of set) {
      expect(message.subject.length).toBeGreaterThan(5);
      expect(`${message.subject} ${message.text}`).not.toMatch(/\{(start|end)\}/);
      expect(message.lang).toBe(locale);
      expect(message.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(message.html).toContain('href="https://status.yayatoh.com/"');
      expect(message.html).not.toMatch(/unsubscribe/i);
      if (moment === 't14' || moment === 't2') expect(message.text).toMatch(/2026|٢٠٢٦|2026年/);
    }
  });

  it('every locale has the same messages and the same arguments as English', () => {
    const en = EMAIL_MESSAGES.en.cutover;
    for (const locale of LOCALES) {
      const c = EMAIL_MESSAGES[locale].cutover;
      expect(c.cta.length, locale).toBeGreaterThan(2);
      for (const audience of CUTOVER_AUDIENCES)
        for (const moment of CUTOVER_MOMENTS) {
          const m = c[audience][moment];
          expect(args(m.subject), `${locale} ${audience} ${moment} subject`).toEqual(
            args(en[audience][moment].subject),
          );
          expect(args(m.intro), `${locale} ${audience} ${moment} intro`).toEqual(
            args(en[audience][moment].intro),
          );
        }
    }
  });

  it('English copy says what keeps working (tickets valid, door scans) and the window', () => {
    const t14 = renderCutoverNotice({
      ...base,
      moment: 't14',
      audience: 'buyer',
      locale: 'en',
      name: 'Amina',
    });
    expect(t14.subject).toBe(
      'Your tickets stay valid during our move on Wednesday, November 4, 2026 at 2:00 AM EST',
    );
    expect(t14.text).toContain('Hi Amina,');
    expect(t14.text).toContain('until 2:45 AM EST');
    expect(t14.text).toContain('tickets you have stay valid');
    const org = renderCutoverNotice({ ...base, moment: 'freezeStart', audience: 'organizer', locale: 'en' });
    expect(org.text).toContain('scan tickets at the door');
    const rollback = renderCutoverNotice({ ...base, moment: 'rollback', audience: 'buyer', locale: 'fr' });
    expect(rollback.dir).toBe('ltr');
    expect(rollback.subject).toBe('Yayatoh revient à la version précédente');
  });

  it('an unknown locale falls back to English; a non-https status link is refused', () => {
    expect(renderCutoverNotice({ ...base, moment: 't2', audience: 'buyer', locale: 'xx' }).lang).toBe('en');
    expect(() =>
      renderCutoverNotice({
        ...base,
        moment: 't2',
        audience: 'buyer',
        locale: 'en',
        statusUrl: 'javascript:alert(1)',
      }),
    ).toThrow(/https/);
  });

  it('escapes the recipient name in the HTML', () => {
    const m = renderCutoverNotice({
      ...base,
      moment: 'freezeEnd',
      audience: 'organizer',
      locale: 'en',
      name: '<img src=x onerror=alert(1)>',
    });
    expect(m.html).not.toContain('<img src=x');
  });
});
