import { describe, expect, it } from 'vitest';
import { clockOffsetMs } from '../src/index.ts';

const T = Date.parse('2027-12-01T20:00:00Z');

describe('clockOffsetMs', () => {
  it('does not correct a clock that agrees with the server within the round trip', () => {
    // The server stamped its time early in a slow answer: that is latency, not skew.
    expect(clockOffsetMs({ serverTime: T + 100, sentAt: T, receivedAt: T + 2_400 })).toBe(0);
    expect(clockOffsetMs({ serverTime: T, sentAt: T, receivedAt: T })).toBe(0);
  });

  it('two good clocks with different latencies get the same (zero) offset', () => {
    const a = clockOffsetMs({ serverTime: T + 50, sentAt: T, receivedAt: T + 300 });
    const b = clockOffsetMs({ serverTime: T + 1_050, sentAt: T + 1_000, receivedAt: T + 3_900 });
    expect(a).toBe(b);
  });

  it('corrects a slow device clock by what the round trip proves', () => {
    // The device runs 90 s slow; the answer took 400 ms.
    const offset = clockOffsetMs({ serverTime: T + 90_200, sentAt: T, receivedAt: T + 400 });
    expect(offset).toBe(89_800);
    expect(Math.abs(offset - 90_000)).toBeLessThanOrEqual(400);
  });

  it('corrects a fast device clock by what the round trip proves', () => {
    // The device runs 30 s fast; the server stamped 100 ms after it was sent.
    const offset = clockOffsetMs({ serverTime: T - 29_900, sentAt: T, receivedAt: T + 250 });
    expect(offset).toBe(-29_900);
    expect(Math.abs(offset + 30_000)).toBeLessThanOrEqual(250);
  });

  it('tolerates a device clock stepping backwards during the request', () => {
    expect(clockOffsetMs({ serverTime: T, sentAt: T + 10, receivedAt: T - 10 })).toBe(0);
  });
});
