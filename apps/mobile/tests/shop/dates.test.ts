import { DATE_PRESETS, isIsoDate, isoDay, presetOf, presetRange, rangeErrors } from '../../src/shop/dates';

// 2027-05-05 is a Wednesday.
const wed = new Date(2027, 4, 5, 15, 30);

describe('date presets', () => {
  it('today is one day', () => {
    expect(presetRange('today', wed)).toEqual({ from: '2027-05-05', to: '2027-05-05' });
  });

  it('the weekend is the coming Friday to Sunday', () => {
    expect(presetRange('weekend', wed)).toEqual({ from: '2027-05-07', to: '2027-05-09' });
  });

  it('on a weekend day the weekend starts today', () => {
    expect(presetRange('weekend', new Date(2027, 4, 7))).toEqual({ from: '2027-05-07', to: '2027-05-09' });
    expect(presetRange('weekend', new Date(2027, 4, 8))).toEqual({ from: '2027-05-08', to: '2027-05-09' });
    expect(presetRange('weekend', new Date(2027, 4, 9))).toEqual({ from: '2027-05-09', to: '2027-05-09' });
  });

  it('the next 7 days and this month', () => {
    expect(presetRange('week', wed)).toEqual({ from: '2027-05-05', to: '2027-05-12' });
    expect(presetRange('month', wed)).toEqual({ from: '2027-05-05', to: '2027-05-31' });
    expect(presetRange('month', new Date(2027, 1, 10))).toEqual({ from: '2027-02-10', to: '2027-02-28' });
  });

  it('finds which preset a range is', () => {
    for (const p of DATE_PRESETS) expect(presetOf(presetRange(p, wed), wed)).toBe(p);
    expect(presetOf({ from: '2027-06-01', to: '2027-06-02' }, wed)).toBeNull();
    expect(presetOf({ from: null, to: null }, wed)).toBeNull();
  });

  it('formats a local calendar date', () => {
    expect(isoDay(new Date(2027, 0, 9))).toBe('2027-01-09');
  });
});

describe('typed dates', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2027-05-01')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2027-13-01')).toBe(false);
    expect(isIsoDate('2027-5-1')).toBe(false);
    expect(isIsoDate('01/05/2027')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('names what is wrong; an empty end is an open end', () => {
    expect(rangeErrors('', '')).toEqual([]);
    expect(rangeErrors('2027-05-01', '')).toEqual([]);
    expect(rangeErrors('soon', '')).toEqual(['from_format']);
    expect(rangeErrors('2027-05-01', '31 May')).toEqual(['to_format']);
    expect(rangeErrors('2027-05-31', '2027-05-01')).toEqual(['order']);
    expect(rangeErrors('2027-05-01', '2027-05-01')).toEqual([]);
  });
});
