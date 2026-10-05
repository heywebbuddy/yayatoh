import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gotenbergRenderer } from '@yayatoh/pdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { GOLDEN, LANGS } from './golden/cases.ts';

/**
 * Golden receipt PDFs (M4.8b acceptance: English and Arabic), rendered by Gotenberg (the pinned
 * image of docker-compose and CI). PDF bytes carry timestamps, so the golden record is what a
 * reader gets out of the file: page count, A4 size in points and each page's text (Arabic shaped
 * glyphs map back through the font's ToUnicode table). Re-record on purpose with `UPDATE_GOLDEN=1`.
 */
const file = join(import.meta.dirname, 'golden', 'pdf.json');
const update = process.env.UPDATE_GOLDEN === '1';
const renderer = gotenbergRenderer({
  url: process.env.GOTENBERG_URL ?? 'http://localhost:3300',
  timeoutMs: 60_000,
});

interface GoldenPdf {
  pages: number;
  size: [number, number];
  text: string[];
}

async function read(bytes: Uint8Array): Promise<GoldenPdf> {
  const pdf = await getDocument({ data: bytes }).promise;
  const text: string[] = [];
  let size: [number, number] = [0, 0];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const [, , w = 0, h = 0] = page.view;
    size = [Math.round(w), Math.round(h)];
    const content = await page.getTextContent();
    text.push(
      content.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  return { pages: pdf.numPages, size, text };
}

describe('golden receipt PDFs (Gotenberg)', { timeout: 60_000 }, () => {
  const recorded: Record<string, GoldenPdf> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

  for (const name of Object.keys(GOLDEN))
    for (const lang of LANGS)
      it(`${name} (${lang})`, async () => {
        const got = await read(await renderer.render({ html: GOLDEN[name]?.(lang) ?? '' }));
        const key = `${name}.${lang}`;
        // One A4 page (595 × 842 pt).
        expect(got.pages).toBe(1);
        expect(got.size).toEqual([595, 842]);
        if (lang === 'ar') expect(got.text.join(' ')).toMatch(/[ﹰ-﻿]/u);
        else if (name === 'receipt-ticket') expect(got.text[0]).toContain('$350.00');
        else if (name === 'receipt-gift') expect(got.text[0]).toContain('No goods or services were provided');
        else if (name === 'receipt-plain')
          expect(got.text[0]).toContain('This payment is not tax-deductible.');
        else expect(got.text[0]).toContain('$450.00');
        if (update || !recorded[key]) {
          recorded[key] = got;
          writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
        }
        expect(got).toEqual(recorded[key]);
      });

  it('covers every golden case', () => {
    expect(Object.keys(recorded).sort()).toEqual(
      Object.keys(GOLDEN)
        .flatMap((n) => LANGS.map((l) => `${n}.${l}`))
        .sort(),
    );
  });
});
