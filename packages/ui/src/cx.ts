import { light } from './tokens.ts';

const kebab = (s: string) => s.replace(/([A-Z]|\d+)/g, (c) => `-${c.toLowerCase()}`);
const ROLES = [...Object.keys(light).map(kebab), 'white', 'black', 'transparent', 'current', 'inherit'];
const ROLE = ROLES.sort((a, b) => b.length - a.length).join('|');
/** A colour utility on a role token, e.g. `hover:bg-surface-2/50` → key `hover:bg`. */
const COLOR = new RegExp(
  `^((?:[^:\\s]+:)*)(bg|text|border(?:-[xytbselr])?|divide|ring|outline|fill|stroke|decoration|placeholder|caret|accent)-(?:${ROLE})(?:/\\d+)?$`,
);

/**
 * Joins class names. When two colour utilities target the same property and variant (a
 * component's `border-line` and a caller's `border-danger`), the later one wins, so a
 * `className` passed to a component reliably overrides its colours (ADR 0022).
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  const tokens = parts.filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
  const last = new Map<string, number>();
  tokens.forEach((t, i) => {
    const m = COLOR.exec(t);
    if (m) last.set(`${m[1]}${m[2]}`, i);
  });
  return tokens
    .filter((t, i) => {
      const m = COLOR.exec(t);
      return !m || last.get(`${m[1]}${m[2]}`) === i;
    })
    .join(' ');
}
