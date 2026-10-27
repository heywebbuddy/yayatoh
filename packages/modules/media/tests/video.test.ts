import { describe, expect, it } from 'vitest';
import { sniffVideo, videoMaxBytes } from '../src/video.ts';

const mp4 = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isom')]);
const webm = Uint8Array.from([
  0x1a,
  0x45,
  0xdf,
  0xa3,
  0x9f,
  0x42,
  0x86,
  0x81,
  0x01,
  0x42,
  0x82,
  0x84,
  ...Buffer.from('webm'),
]);

describe('uploaded video checks', () => {
  it('knows MP4 and WebM by their bytes', () => {
    expect(sniffVideo(mp4)).toBe('mp4');
    expect(sniffVideo(webm)).toBe('webm');
  });

  it('refuses images, other containers and text', () => {
    expect(sniffVideo(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffVideo(Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypavif'), 0, 0, 0, 0]))).toBeNull();
    expect(sniffVideo(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
  });

  it('caps at 200 MB unless the environment says otherwise (1 MB to 1 GB)', () => {
    expect(videoMaxBytes({})).toBe(200 * 1024 * 1024);
    expect(videoMaxBytes({ MEDIA_VIDEO_MAX_BYTES: String(50 * 1024 * 1024) })).toBe(50 * 1024 * 1024);
    expect(videoMaxBytes({ MEDIA_VIDEO_MAX_BYTES: '12' })).toBe(200 * 1024 * 1024);
  });
});
