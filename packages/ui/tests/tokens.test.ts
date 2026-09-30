import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { color } from '../src/tokens.ts';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function flatten(obj: Record<string, unknown>, prefix: string): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${prefix}-${k}`, v] as [string, string]]
      : flatten(v as Record<string, unknown>, `${prefix}-${k}`),
  );
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('tokens.ts ↔ styles.css', () => {
  it('declares every colour token with the same value', () => {
    for (const [name, value] of flatten(color, '--color')) {
      const cssName = kebab(name);
      const m = new RegExp(`${cssName}:\\s*([^;]+);`).exec(css);
      const norm = (v: string | undefined) => v?.replace(/\s+/g, '').toUpperCase();
      expect(norm(m?.[1]), cssName).toBe(norm(value));
    }
  });

  it('keeps the brand accent at ADR 0018 vermillion', () => {
    expect(color.accent[900]).toBe('#FC5F2B');
  });
});
