import { describe, expect, it } from 'vitest';
import { deviceLabel } from '../src/lib/device-label.ts';

describe('deviceLabel', () => {
  it('names the browser and system', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome · Android');
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari · iOS');
    expect(
      deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'),
    ).toBe('Firefox · Windows');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
      ),
    ).toBe('Edge · macOS');
    expect(deviceLabel(null)).toBe('Browser');
    expect(deviceLabel('<script>')).toBe('Browser');
  });
});
