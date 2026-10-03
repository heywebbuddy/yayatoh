import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN, LANGS } from './golden/cases.ts';

/**
 * Golden receipt HTML (M4.8b): what the PDF renderer receives for each case in English and Arabic
 * is exactly the recorded file. A failure means a receipt changed: review the diff (receipt text is
 * legal-copy) and re-record on purpose with `UPDATE_GOLDEN=1`. (golden.int.test.ts renders them.)
 */
const dir = join(import.meta.dirname, 'golden');
const update = process.env.UPDATE_GOLDEN === '1';

describe('golden receipt HTML', () => {
  for (const name of Object.keys(GOLDEN))
    for (const lang of LANGS)
      it(`${name} (${lang})`, () => {
        const file = join(dir, `${name}.${lang}.html`);
        const out = GOLDEN[name]?.(lang) ?? '';
        if (update || !existsSync(file)) writeFileSync(file, out);
        expect(out).toBe(readFileSync(file, 'utf8'));
        expect(out).not.toMatch(/(src|href)="(https?:)?\/\/|url\(|@import/);
        expect(out).toContain(lang === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
      });

  it('says what P4-11 requires in English', () => {
    const ticket = GOLDEN['receipt-ticket']?.('en') ?? '';
    expect(ticket).toContain('Tax-deductible amount</dt><dd>$350.00');
    expect(ticket).toContain('Fair-market value of goods or services</dt><dd>$150.00');
    expect(ticket).toContain('EIN</dt><dd>23-4567891');
    expect(ticket).toContain('is limited to $350.00');
    expect(ticket).toContain('May 14, 2027'); // the org's timezone: in UTC it is already May 15
    const gift = GOLDEN['receipt-gift']?.('en') ?? '';
    expect(gift).toContain('No goods or services were provided in exchange for this contribution.');
    expect(gift).toContain('Section 501(c)(3)');
    const plain = GOLDEN['receipt-plain']?.('en') ?? '';
    expect(plain).toContain('Payment receipt');
    expect(plain).toContain('This payment is not tax-deductible.');
    expect(plain).not.toContain('501(c)(3)');
    expect(plain).not.toContain('Tax-deductible amount');
    const st = GOLDEN.statement?.('en') ?? '';
    expect(st).toContain('2027 giving statement');
    expect(st).toContain('Total tax-deductible amount for 2027: $450.00.');
    expect(st).not.toContain('2,027');
  });

  it('Arabic receipts are right to left with the Arabic wording', () => {
    const ticket = GOLDEN['receipt-ticket']?.('ar') ?? '';
    expect(ticket).toContain('lang="ar" dir="rtl"');
    expect(ticket).toContain('إيصال تبرّع');
    expect(GOLDEN['receipt-gift']?.('ar')).toContain('لم تُقدَّم أي سلع أو خدمات مقابل هذه المساهمة.');
    expect(GOLDEN['receipt-plain']?.('ar')).toContain('هذه الدفعة غير قابلة للخصم الضريبي.');
  });
});
