import { ACCEPT_MIME, MAX_PER_SLOT, MAX_UPLOAD_BYTES } from '@yayatoh/media';
import { describe, expect, it } from 'vitest';
import { GALLERY_MAX, looksLikeImage, UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from '../src/lib/media-limits.ts';

describe('uploader limits mirror the media module', () => {
  it('same size cap, types and slot size', () => {
    expect(UPLOAD_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
    expect([...UPLOAD_ACCEPT]).toEqual([...ACCEPT_MIME]);
    expect(GALLERY_MAX).toBe(MAX_PER_SLOT);
  });

  it('checks the picked file by type, or by extension when the browser gives none', () => {
    expect(looksLikeImage({ name: 'a.png', type: 'image/png' })).toBe(true);
    expect(looksLikeImage({ name: 'a.txt', type: 'text/plain' })).toBe(false);
    expect(looksLikeImage({ name: 'logo.SVG', type: '' })).toBe(true);
    expect(looksLikeImage({ name: 'doc.pdf', type: '' })).toBe(false);
  });
});
