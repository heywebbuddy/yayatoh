import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_TEMPLATES, goldenHtml, LANGS } from './golden/cases.ts';

/**
 * Golden badge documents (M5.5a): the HTML the PDF renderer receives for 3 templates in English
 * and Arabic is exactly the recorded file. A failure means the badge output changed: review the
 * diff and re-record on purpose with `UPDATE_GOLDEN=1`. (golden.int.test.ts renders them.)
 */
const dir = join(import.meta.dirname, 'golden');
const update = process.env.UPDATE_GOLDEN === '1';

describe('golden badge HTML', () => {
  for (const name of Object.keys(GOLDEN_TEMPLATES))
    for (const lang of LANGS)
      it(`${name} (${lang})`, () => {
        const file = join(dir, `${name}.${lang}.html`);
        const out = goldenHtml(name, lang);
        if (update || !existsSync(file)) writeFileSync(file, out);
        expect(out).toBe(readFileSync(file, 'utf8'));
        // Self-contained: nothing for the renderer to fetch.
        expect(out).not.toMatch(/(src|href)="(https?:)?\/\/|url\(|@import/);
        expect(out).toContain(lang === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
      });

  it('mirrors the Arabic layout: the first element sits on the other side', () => {
    const left = (html: string) => Number(/class="el"[^>]*style="left:([\d.]+)mm/.exec(html)?.[1]);
    expect(left(goldenHtml('cr80-staff', 'en'))).toBe(4);
    expect(left(goldenHtml('cr80-staff', 'ar'))).toBeCloseTo(53.98 - 4 - 40, 1);
    // Start-aligned text sits on the reading side.
    expect(goldenHtml('cr80-staff', 'en')).toContain('text-align:left;justify-content:flex-start');
    expect(goldenHtml('cr80-staff', 'ar')).toContain('text-align:right;justify-content:flex-end');
  });
});
