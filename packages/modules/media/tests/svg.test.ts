import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { processImage } from '../src/pipeline/process.ts';
import { SvgRejected, sanitizeCss, sanitizeSvg } from '../src/pipeline/svg.ts';

const dir = join(import.meta.dirname, '..', 'fixtures');
const corpus = readdirSync(join(dir, 'malicious')).filter((f) => f.endsWith('.svg'));

/** Nothing in a sanitized document may run code, fetch anything, or expand entities. */
export function assertInert(svg: string) {
  // The namespace declarations are the only URIs allowed to remain.
  const lower = svg
    .replace(' xmlns="http://www.w3.org/2000/svg"', '')
    .replace(' xmlns:xlink="http://www.w3.org/1999/xlink"', '')
    .toLowerCase();
  expect(lower).not.toMatch(/<\s*(\w+:)?script/);
  expect(lower).not.toMatch(/\son\w+\s*=/);
  expect(lower).not.toContain('javascript');
  expect(lower).not.toContain('foreignobject');
  expect(lower).not.toMatch(/<\s*(iframe|embed|object|handler|set|animate|feimage|a)[\s/>]/);
  expect(lower).not.toMatch(/https?:|file:|\/\/evil|evil\.example/);
  expect(lower).not.toMatch(/@import|@font-face|<!doctype|<!entity|<\?xml-stylesheet/);
  expect(lower).not.toContain('lol');
  expect(lower).not.toMatch(/(href|xlink:href)="(?!#)/);
}

describe('SVG sanitizer: malicious corpus', () => {
  it('has the whole corpus', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(14);
  });

  it.each(corpus)('%s comes out inert', (name) => {
    const src = readFileSync(join(dir, 'malicious', name));
    const out = sanitizeSvg(src);
    assertInert(out.svg);
    expect(out.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    // Sanitizing again changes nothing (the output is already inside the safe subset).
    expect(sanitizeSvg(out.svg).svg).toBe(out.svg);
  });

  it.each(corpus)('%s still rasterizes, and every variant stays inert', async (name) => {
    const out = await processImage(new Uint8Array(readFileSync(join(dir, 'malicious', name))));
    expect(out.sourceType).toBe('svg');
    const vector = out.variants.find((v) => v.format === 'svg');
    assertInert(new TextDecoder().decode(vector?.bytes));
    expect(out.removed.length).toBeGreaterThan(0);
  });

  it('reports what it removed', () => {
    const { removed } = sanitizeSvg(readFileSync(join(dir, 'malicious', 'onload.svg')));
    expect(removed).toEqual(expect.arrayContaining(['@onload', '@onclick', '@ONMOUSEOVER']));
  });

  it('entity expansion: the DOCTYPE is discarded and undefined entities expand to nothing', () => {
    const { svg } = sanitizeSvg(readFileSync(join(dir, 'malicious', 'entity-expansion.svg')));
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="0" y="9"/></svg>',
    );
  });

  it('decodes character references before judging a URL', () => {
    const { svg } = sanitizeSvg(
      '<svg><rect fill="&#106;avascript&#x3A;x" width="1"/><use href="&#x23;ok"/><g id="ok"/></svg>',
    );
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/><use href="#ok"/><g id="ok"/></svg>',
    );
  });

  it('text cannot smuggle markup: it is re-escaped', () => {
    const { svg } = sanitizeSvg('<svg><text>&lt;script&gt;alert(1)&lt;/script&gt;</text></svg>');
    expect(svg).toContain('<text>&lt;script&gt;alert(1)&lt;/script&gt;</text>');
    const cdata = sanitizeSvg('<svg><text><![CDATA[</text><script>x</script>]]></text></svg>');
    expect(cdata.svg).not.toContain('<script');
  });
});

describe('SVG sanitizer: safe documents keep working', () => {
  it('keeps gradients, local <use>, classes with local url() and titles', () => {
    const { svg, removed } = sanitizeSvg(readFileSync(join(dir, 'logo.svg')));
    expect(svg).toContain('<linearGradient id="g"');
    expect(svg).toContain('<use xlink:href="#dot"');
    expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(svg).toContain('.mark { fill: url(#g); }');
    expect(svg).toContain('<title>Example logo</title>');
    expect(removed).toEqual(['!doctype']);
  });

  it('keeps embedded raster data images, drops embedded SVG data', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeSvg(`<svg><image href="${png}" width="1" height="1"/></svg>`).svg).toContain(
      `href="${png}"`,
    );
    expect(sanitizeSvg('<svg><image href="data:image/svg+xml;base64,PHN2Zz4=" width="1"/></svg>').svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
  });

  it('refuses what is not a single well-formed <svg> document', () => {
    const reason = (s: string) => {
      try {
        sanitizeSvg(s);
        return null;
      } catch (e) {
        return e instanceof SvgRejected ? e.reason : 'other';
      }
    };
    expect(reason(readFileSync(join(dir, 'broken.svg'), 'utf8'))).toBe('svg_malformed');
    expect(reason('<svg><g></svg></g>')).toBe('svg_malformed');
    expect(reason('<svg><rect x=1/></svg>')).toBe('svg_malformed');
    expect(reason('<svg><rect x="<"/></svg>')).toBe('svg_malformed');
    expect(reason('<html/>')).toBe('svg_not_svg');
    expect(reason('<svg/><svg/>')).toBe('svg_not_svg');
    expect(reason('text<svg/>')).toBe('svg_not_svg');
    expect(reason(`<svg>${'<g>'.repeat(200)}${'</g>'.repeat(200)}</svg>`)).toBe('svg_too_complex');
    expect(reason(`<svg>${'<g/>'.repeat(20_001)}</svg>`)).toBe('svg_too_complex');
    expect(reason(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0xff, 0x3e]) as unknown as string)).toBe(
      'svg_malformed',
    );
  });
});

describe('CSS sanitizer', () => {
  it('keeps local url() and drops remote ones', () => {
    expect(sanitizeCss('fill: url(#a); stroke: url("#b")')).toBe('fill: url(#a); stroke: url("#b")');
    expect(sanitizeCss('background: url(https://x.test/a.png)')).toBe('background: none');
    expect(sanitizeCss("background: url('//x.test/a')")).toBe('background: none');
  });

  it('drops loading at-rules and refuses escapes and scriptable CSS', () => {
    expect(sanitizeCss('@import "x.css"; .a { fill: red }')).toBe(' .a { fill: red }');
    expect(sanitizeCss('.a { behavior: url(x.htc) }')).toBeNull();
    expect(sanitizeCss('.a { width: expression(alert(1)) }')).toBeNull();
    expect(sanitizeCss('.a { background: u\\72l(x) }')).toBeNull();
    expect(sanitizeCss('/* */ .a { -moz-binding: url(x) }')).toBeNull();
  });
});
