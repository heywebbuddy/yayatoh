import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gotenbergRenderer } from '@yayatoh/pdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { cardsOf, PAPER, seatingSheet, sheetLayout } from '../src/index.ts';
import { GOLDEN_CASES, goldenHtml, LANGS, WEDDING_VIEW } from './golden/cases.ts';

/**
 * Golden card PDFs (M4.3b acceptance): place, escort and table cards of the fixture wedding in
 * English and Arabic, rendered by Gotenberg (the pinned image of docker-compose and CI). PDF bytes
 * carry timestamps and ids, so the golden record is what a reader gets out of the file: page
 * count, page size in points, and each page's text (Arabic shaped glyphs map back to their letters
 * through the font's ToUnicode table). Re-record on purpose with `UPDATE_GOLDEN=1`.
 */
const file = join(import.meta.dirname, 'golden', 'pdf.json');
const update = process.env.UPDATE_GOLDEN === '1';
const renderer = gotenbergRenderer({
  url: process.env.GOTENBERG_URL ?? 'http://localhost:3300',
  timeoutMs: 60_000,
});
const PT_PER_MM = 72 / 25.4;

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

describe('golden card PDFs (Gotenberg)', { timeout: 60_000 }, () => {
  const recorded: Record<string, GoldenPdf> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const seen: Record<string, GoldenPdf> = {};
  const sheet = seatingSheet(WEDDING_VIEW);

  for (const name of Object.keys(GOLDEN_CASES))
    for (const lang of LANGS)
      it(`${name} (${lang})`, async () => {
        const c = GOLDEN_CASES[name];
        if (!c) throw new Error(name);
        const got = await read(await renderer.render({ html: goldenHtml(name, lang) }));
        const key = `${name}.${lang}`;
        seen[key] = got;
        // Every card printed, on pages of the chosen paper size.
        const cards = cardsOf(c.kind, sheet).length;
        expect(got.pages).toBe(Math.ceil(cards / sheetLayout(c.kind, c.paper).perPage));
        const p = PAPER[c.paper];
        expect(got.size).toEqual([Math.round(p.widthMm * PT_PER_MM), Math.round(p.heightMm * PT_PER_MM)]);
        const all = got.text.join(' ');
        // Arabic is shaped: the PDF holds contextual letter forms (Arabic Presentation Forms-B),
        // from the Arabic words (and from the guests' Arabic names on every place and escort sheet).
        if (lang === 'ar' || c.kind !== 'table') expect(all).toMatch(/[ﹰ-﻿]/u);
        if (c.kind !== 'table') expect(all).toContain('García');
        if (lang === 'en') expect(all).toMatch(c.kind === 'escort' ? /your table/i : /Table 10/);
        expect(all).not.toContain('Kai Chen');
        if (update || !recorded[key]) {
          recorded[key] = got;
          writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
        }
        expect(got).toEqual(recorded[key]);
      });

  it('covers every golden case', () => {
    expect(Object.keys(recorded).sort()).toEqual(
      Object.keys(GOLDEN_CASES)
        .flatMap((n) => LANGS.map((l) => `${n}.${l}`))
        .sort(),
    );
    expect(Object.keys(seen)).toHaveLength(6);
  });
});
