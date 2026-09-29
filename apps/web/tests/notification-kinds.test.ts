import { readFileSync } from 'node:fs';
import { LOCALES } from '@yayatoh/contracts';
import { EMAIL_KINDS, MESSAGE_KINDS } from '@yayatoh/notifications';
import { describe, expect, it } from 'vitest';

type Tree = { [k: string]: string | Tree };
const load = (l: string): Tree =>
  JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url), 'utf8'));
const at = (t: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Tree)[k] : undefined), t);

/**
 * Every message kind is rendered through `notifications.kinds.<kind>` (the Emails page, the
 * messaging log, order timelines), so a kind must never ship without a label in every locale.
 */
describe('notification kind labels', () => {
  const kinds = [...new Set([...MESSAGE_KINDS, ...EMAIL_KINDS])];

  it.each(LOCALES)('%s labels every message kind', (locale) => {
    const tree = load(locale);
    const missing = kinds.filter((k) => {
      const v = at(tree, `notifications.kinds.${k}`);
      return typeof v !== 'string' || v.trim() === '';
    });
    expect(missing).toEqual([]);
  });
});
