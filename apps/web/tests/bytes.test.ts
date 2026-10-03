import { describe, expect, it } from 'vitest';
import { formatBytes, percentOf } from '../src/lib/bytes.ts';

describe('U10 storage figures', () => {
  it('formats sizes in binary units per locale', () => {
    expect(formatBytes(512, 'en')).toBe('512 byte');
    expect(formatBytes(1536, 'en')).toBe('1.5 kB');
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5 MB');
    expect(formatBytes(1024 ** 3, 'en')).toBe('1 GB');
    expect(formatBytes(1536, 'de')).toBe('1,5 kB');
  });

  it('percent of quota: rounded, at least 1 % when anything is used, at most 100 %', () => {
    expect(percentOf(0, 100)).toBe(0);
    expect(percentOf(1, 1_000_000)).toBe(1);
    expect(percentOf(50, 100)).toBe(50);
    expect(percentOf(300, 100)).toBe(100);
    expect(percentOf(1, 0)).toBe(100);
  });
});
