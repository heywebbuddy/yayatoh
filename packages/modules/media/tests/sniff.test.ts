import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sniff } from '../src/pipeline/sniff.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', name)));
const bytes = (...v: number[]) => new Uint8Array(v);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniff (magic bytes, never the name or header)', () => {
  it.each([
    ['banner.png', 'png'],
    ['alpha.png', 'png'],
    ['photo-exif.jpg', 'jpeg'],
    ['still.gif', 'gif'],
    ['small.webp', 'webp'],
    ['tiny.avif', 'avif'],
    ['logo.svg', 'svg'],
  ])('%s is %s', (name, type) => {
    expect(sniff(fixture(name))).toBe(type);
  });

  it('a text file named .png is not an image', () => {
    expect(sniff(fixture('text.png'))).toBeNull();
  });

  it('HTML named .svg is not an SVG', () => {
    expect(sniff(fixture('html.svg'))).toBeNull();
    expect(sniff(text('<!DOCTYPE html><svg></svg>'))).toBeNull();
  });

  it('signatures need every byte', () => {
    expect(sniff(bytes(0xff, 0xd8))).toBeNull();
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a))).toBeNull();
    expect(sniff(text('GIF88a'))).toBeNull();
    expect(sniff(text('RIFF\0\0\0\0WAVE'))).toBeNull();
    expect(sniff(new Uint8Array(0))).toBeNull();
  });

  it('ISO-BMFF files are AVIF only with an avif/avis brand', () => {
    const box = (major: string, compat: string) =>
      new Uint8Array([0, 0, 0, 20, ...text('ftyp'), ...text(major), 0, 0, 0, 0, ...text(compat)]);
    expect(sniff(box('avif', 'mif1'))).toBe('avif');
    expect(sniff(box('mif1', 'avis'))).toBe('avif');
    expect(sniff(box('heic', 'mif1'))).toBeNull();
    expect(sniff(box('isom', 'mp41'))).toBeNull();
  });

  it('SVG: BOM, XML declaration, comments and a DOCTYPE may come first', () => {
    expect(
      sniff(
        text('\uFEFF<?xml version="1.0"?>\n<!-- made by hand -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
      ),
    ).toBe('svg');
    expect(sniff(text('<!DOCTYPE svg [<!ENTITY a "b">]><svg/>'))).toBe('svg');
  });

  it('SVG must be UTF-8 text without NUL bytes', () => {
    expect(sniff(new Uint8Array([...text('<svg>'), 0, ...text('</svg>')]))).toBeNull();
    expect(sniff(new Uint8Array([...text('<svg>'), 0xff, 0xfe, ...text('</svg>')]))).toBeNull();
    expect(sniff(text('<svgfoo/>'))).toBeNull();
  });
});
