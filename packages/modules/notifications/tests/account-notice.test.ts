import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import { memoryTransports, sendAccountNotice } from '../src/index.ts';
import { renderAccountNotice } from '../src/templates/render.ts';

describe('account-deleted notice (M1.14e)', () => {
  it.each(LOCALES)('renders in %s with the platform sender and no unsubscribe link', (locale) => {
    const r = renderAccountNotice({ notice: 'deleted', locale, name: 'Ada' });
    expect(r.subject.length).toBeGreaterThan(5);
    expect(r.html).toContain(`lang="${locale}"`);
    expect(r.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(r.html).not.toMatch(/unsubscribe/i);
    expect(r.text).toContain('Ada');
  });

  it('falls back to English and escapes the name', () => {
    const r = renderAccountNotice({ notice: 'deleted', locale: 'xx', name: '<b>Ada</b>' });
    expect(r.subject).toBe('Your Yayatoh account was deleted');
    expect(r.html).not.toContain('<b>Ada</b>');
  });

  it('sends one email from the platform sender', async () => {
    const { transports, emails } = memoryTransports();
    await sendAccountNotice(transports.email, { to: 'ada@example.test', name: 'Ada', locale: 'fr' });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      to: 'ada@example.test',
      from: { name: 'Yayatoh', address: 'notifications@mail.yayatoh.com' },
      subject: 'Votre compte Yayatoh a été supprimé',
    });
  });
});
