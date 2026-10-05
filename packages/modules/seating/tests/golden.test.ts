import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES, goldenHtml, LANGS } from './golden/cases.ts';

/**
 * Golden card documents (M4.3b): the HTML the PDF renderer receives for place, escort and table
 * cards of the fixture wedding in English and Arabic is exactly the recorded file. A failure
 * means the card output changed: review the diff and re-record on purpose with `UPDATE_GOLDEN=1`.
 * (golden.int.test.ts renders them with Gotenberg.)
 */
const dir = join(import.meta.dirname, 'golden');
const update = process.env.UPDATE_GOLDEN === '1';

describe('golden card HTML', () => {
  for (const name of Object.keys(GOLDEN_CASES))
    for (const lang of LANGS)
      it(`${name} (${lang})`, () => {
        const file = join(dir, `${name}.${lang}.html`);
        const out = goldenHtml(name, lang);
        if (update || !existsSync(file)) writeFileSync(file, out);
        expect(out).toBe(readFileSync(file, 'utf8'));
        // Self-contained: nothing for the renderer to fetch, nothing to run.
        expect(out).not.toMatch(/(src|href)="(https?:)?\/\/|url\(|@import|<script/);
        expect(out).toContain(lang === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
      });

  it('escapes what hosts typed and isolates names', () => {
    const out = goldenHtml('place-a4', 'en');
    expect(out).toContain('<bdi>Ana García</bdi>');
    expect(out).toContain('<bdi>ليلى حداد</bdi>');
    expect(goldenHtml('table-a5', 'en')).toContain('Harper &amp; Theo');
  });

  it('mirrors the sheet in Arabic: the first card is on the right', () => {
    const first = (html: string) => /\.s0 \{ left: ([\d.]+)mm/.exec(html)?.[1];
    expect(first(goldenHtml('place-a4', 'en'))).toBe('15');
    expect(first(goldenHtml('place-a4', 'ar'))).toBe('105');
  });

  it('prints the date in the event time zone, in the card language', () => {
    // 2027-06-12T23:00Z is 12 June in Los Angeles (13 June in UTC).
    expect(goldenHtml('table-a5', 'en')).toContain('June 12, 2027');
    expect(goldenHtml('table-a5', 'ar')).toContain('يونيو');
  });
});
