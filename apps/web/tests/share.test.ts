import { describe, expect, it } from 'vitest';
import { whatsappHref } from '../src/lib/share.ts';

describe('whatsappHref', () => {
  it('builds a wa.me link with the text encoded once', () => {
    const url = 'https://example.test/claim/abc?x=1&y=2';
    const href = whatsappHref(`Here is your ticket: ${url}`);
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(new URL(href).searchParams.get('text')).toBe(`Here is your ticket: ${url}`);
  });
});
