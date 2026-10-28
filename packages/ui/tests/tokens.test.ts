import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio } from '../src/contrast.ts';
import { dark, gradient, light, radius, shadow, showcase, showcaseLight } from '../src/tokens.ts';

// Checked out with CRLF on Windows: the selectors below span lines, so compare with LF.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

const kebab = (s: string) => s.replace(/([A-Z]|\d+)/g, (c) => `-${c.toLowerCase()}`);
// The formatter writes 0.40 as 0.4: compare numbers without trailing zeros.
const norm = (v: string | undefined) =>
  v
    ?.replace(/\s+/g, '')
    .replace(/(\.\d*?)0+(?=\D|$)/g, '$1')
    .replace(/\.(?=\D|$)/g, '')
    .toUpperCase();

/** The declarations inside the first block that follows `selector`. */
function block(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function value(src: string, name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(src)?.[1];
}

const MODES = [
  { name: 'light', selector: ':root,\n[data-theme="light"]', colors: light, extra: 'light' as const },
  { name: 'dark', selector: '[data-theme="dark"] {', colors: dark, extra: 'dark' as const },
  {
    name: 'system (dark)',
    selector: '@media (prefers-color-scheme: dark) {\n  [data-theme="system"]',
    colors: dark,
    extra: 'dark' as const,
  },
];

describe('tokens.ts ↔ styles.css', () => {
  for (const mode of MODES) {
    it(`declares every ${mode.name} colour, gradient and elevation with the same value`, () => {
      const src = block(mode.selector);
      for (const [role, v] of Object.entries(mode.colors))
        expect(norm(value(src, `--color-${kebab(role)}`)), `${mode.name} ${role}`).toBe(norm(v));
      for (const [k, v] of Object.entries(gradient[mode.extra]))
        expect(norm(value(src, `--gradient-${kebab(k)}`)), `${mode.name} gradient ${k}`).toBe(norm(v));
      for (const [k, v] of Object.entries(shadow[mode.extra]))
        expect(norm(value(src, `--elevation-${kebab(k)}`)), `${mode.name} elevation ${k}`).toBe(norm(v));
      expect(value(src, 'color-scheme')).toBe(mode.extra);
    });
  }

  it('registers every colour role as a utility (light values in @theme)', () => {
    const theme = block('@theme');
    for (const [role, v] of Object.entries(light))
      expect(norm(value(theme, `--color-${kebab(role)}`)), role).toBe(norm(v));
    // The Tailwind default palette is off, so `bg-zinc-100` and friends generate nothing.
    expect(theme).toContain('--color-*: initial;');
  });

  it('declares every radius by role', () => {
    const theme = block('@theme');
    for (const [k, v] of Object.entries(radius)) expect(value(theme, `--radius-${k}`), k).toBe(v);
  });

  it('keeps the approved brand values (decision 2026-10-02)', () => {
    expect(light.primary).toBe('#6A3BFF');
    expect(light.brand).toBe('#FF3D86');
    expect(dark.sideTileOn).toBe('#7B5CFF');
    expect(light.canvas).toBe('#F2F1F6');
    expect(dark.canvas).toBe('#0A0812');
    expect(radius.card).toBe('24px');
    expect(radius.panel).toBe('28px');
  });

  it('gives both modes the same roles', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('declares the dark showcase surface with the same values', () => {
    const src = block('[data-theme="dark"] [data-surface="showcase"] {');
    expect(norm(value(src, '--color-canvas'))).toBe(norm(showcase.canvas));
    expect(norm(value(src, '--color-surface'))).toBe(norm(showcase.surface));
    expect(norm(value(src, '--color-ink'))).toBe(norm(showcase.ink));
    expect(norm(value(src, '--color-primary'))).toBe(norm(showcase.primary));
    expect(norm(value(src, '--gradient-ember'))).toBe(
      norm(
        `linear-gradient(100deg, ${showcase.ember[0]} 0%, ${showcase.ember[1]} 52%, ${showcase.ember[2]} 100%)`,
      ),
    );
  });

  it('declares the light showcase surface (the default) with the same values', () => {
    const src = block('[data-surface="showcase"] {');
    expect(norm(value(src, '--color-canvas'))).toBe(norm(showcaseLight.canvas));
    expect(norm(value(src, '--color-surface'))).toBe(norm(showcaseLight.surface));
    expect(norm(value(src, '--color-ink'))).toBe(norm(showcaseLight.ink));
    expect(norm(value(src, '--color-primary'))).toBe(norm(showcaseLight.primary));
    expect(norm(value(src, '--gradient-ember'))).toBe(
      norm(
        `linear-gradient(100deg, ${showcaseLight.ember[0]} 0%, ${showcaseLight.ember[1]} 52%, ${showcaseLight.ember[2]} 100%)`,
      ),
    );
    expect(value(src, 'color-scheme')).toBe('light');
  });

  it('follows the system for the showcase when the theme is "system"', () => {
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) {\n  [data-theme="system"] [data-surface="showcase"]',
    );
  });

  for (const [name, selector] of [
    ['light', '[data-surface="showcase"] {'],
    ['dark', '[data-theme="dark"] [data-surface="showcase"] {'],
  ] as const) {
    it(`keeps the ${name} showcase text readable (AA: 4.5:1, 3:1 for UI lines and focus)`, () => {
      const src = block(selector);
      const v = (n: string) => value(src, n)?.trim() as string;
      const canvas = v('--color-canvas');
      const surfaces = [canvas, v('--color-surface'), v('--color-surface-2')];
      const on = (fg: string, bg: string) => contrastRatio(composite(fg, bg), bg);
      const failures: string[] = [];
      for (const bg of surfaces)
        for (const role of [
          'ink',
          'ink-2',
          'ink-3',
          'primary-ink',
          'brand-ink',
          'success',
          'warning',
          'danger',
        ])
          if (on(v(`--color-${role}`), bg) < 4.5) failures.push(`${role} on ${bg}`);
      if (on(v('--color-on-primary'), v('--color-primary')) < 4.5) failures.push('on-primary on primary');
      if (on(v('--color-tag-ink'), composite(v('--color-tag'), canvas)) < 4.5)
        failures.push('tag ink on tag');
      if (on('#ffffff', composite(v('--color-tag'), canvas)) < 4.5) failures.push('white on tag');
      if (on(v('--color-focus'), canvas) < 3) failures.push('focus on canvas');
      if (on(v('--color-line-strong'), v('--color-surface')) < 3) failures.push('line-strong on surface');
      // Text on the soft tints of the semantic roles.
      for (const role of ['primary', 'brand', 'success', 'warning', 'danger']) {
        const soft = composite(v(`--color-${role}-soft`), v('--color-surface'));
        const ink =
          role === 'primary'
            ? v('--color-primary-ink')
            : role === 'brand'
              ? v('--color-brand-ink')
              : v(`--color-${role}`);
        if (contrastRatio(ink, soft) < 4.5) failures.push(`${role} text on its soft tint`);
      }
      expect(failures).toEqual([]);
    });
  }
});
