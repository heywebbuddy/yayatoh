import { describe, expect, it } from 'vitest';
import { disputeAlertLevel } from '../src/dispute-alerts.ts';

const now = new Date('2027-10-01T12:00:00Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe('dispute deadline alert levels (M3.10c)', () => {
  it('nothing without a deadline or with more than three days left', () => {
    expect(disputeAlertLevel(null, now)).toBe(0);
    expect(disputeAlertLevel(inHours(73), now)).toBe(0);
  });
  it('the first alert at three days, the second at one day or once past', () => {
    expect(disputeAlertLevel(inHours(72), now)).toBe(1);
    expect(disputeAlertLevel(inHours(25), now)).toBe(1);
    expect(disputeAlertLevel(inHours(24), now)).toBe(2);
    expect(disputeAlertLevel(inHours(1), now)).toBe(2);
    expect(disputeAlertLevel(inHours(-5), now)).toBe(2);
  });
});
