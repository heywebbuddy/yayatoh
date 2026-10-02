import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dark, gradient, light, radius, shadow } from '../src/tokens.ts';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const kebab = (s: string) => s.replace(/([A-Z]|\d+)/g, (c) => `-${c.toLowerCase()}`);
const norm = (v: string | undefined) => v?.replace(/\s+/g, '').toUpperCase();

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
});
