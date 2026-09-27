import { readFileSync } from 'node:fs';
import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';

type Tree = { [k: string]: string | Tree };
const load = (l: string): Tree =>
  JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url), 'utf8'));
const keys = (t: Tree, p = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : keys(v, `${p}${k}.`)));

describe('messages', () => {
  const en = keys(load('en')).sort();

  it.each(LOCALES)('%s has exactly the English keys, all non-empty', (locale) => {
    const tree = load(locale);
    expect(keys(tree).sort()).toEqual(en);
    const values = (t: Tree): string[] =>
      Object.values(t).flatMap((v) => (typeof v === 'string' ? [v] : values(v)));
    for (const v of values(tree)) expect(v.trim()).not.toBe('');
  });
});
