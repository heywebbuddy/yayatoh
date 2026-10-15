import {
  currencyDigits,
  formatDistance,
  formatEventStart,
  formatEventWhen,
  formatMoney,
  formatPriceRange,
} from '../../src/shop/format';

describe('formatMoney', () => {
  it('takes the decimals from the currency, never a fixed 100', () => {
    expect(currencyDigits('EUR', 'en')).toBe(2);
    expect(currencyDigits('JPY', 'en')).toBe(0);
    expect(currencyDigits('BHD', 'en')).toBe(3);
    expect(formatMoney(1250, 'EUR', 'en')).toBe('€12.50');
    expect(formatMoney(1250, 'JPY', 'en')).toBe('¥1,250');
    expect(formatMoney(12500, 'BHD', 'en')).toBe('BHD\u00a012.500');
  });

  it('writes the amount the way each language does', () => {
    expect(formatMoney(1250, 'EUR', 'de')).toBe('12,50 €');
    expect(formatMoney(1250, 'EUR', 'fr')).toBe('12,50 €');
    expect(formatMoney(123456, 'USD', 'en')).toBe('$1,234.56');
    expect(formatMoney(123456, 'USD', 'es')).toMatch(/1\.234,56|1234,56/);
    expect(formatMoney(1250, 'EUR', 'ar')).toMatch(/[١٢]|12/);
  });

  it('keeps a made-up currency readable instead of throwing', () => {
    expect(formatMoney(1250, 'XYZ', 'en')).toBe('XYZ 12.50');
    expect(formatMoney(1250, 'not a currency', 'en')).toBe('12.50 not a currency');
  });
});

describe('dates in the event time zone', () => {
  const start = '2027-05-01T23:30:00Z';
  const end = '2027-05-02T02:00:00Z';

  it('shows the event’s own wall clock, not the phone’s', () => {
    expect(formatEventStart(start, 'Asia/Tokyo', 'en')).toBe('Sun, May 2, 8:30 AM');
    expect(formatEventStart(start, 'America/Los_Angeles', 'en')).toBe('Sat, May 1, 4:30 PM');
  });

  it('writes a one-day event as a range with the zone name, and a longer one with an arrow', () => {
    expect(formatEventWhen(start, end, 'America/Los_Angeles', 'en')).toBe(
      'Sat, May 1, 4:30 PM – 7:00 PM PDT',
    );
    expect(formatEventWhen(start, '2027-05-03T20:00:00Z', 'America/Los_Angeles', 'en')).toBe(
      'Sat, May 1, 4:30 PM → Mon, May 3, 1:00 PM PDT',
    );
  });

  it('judges "the same day" in the event’s zone', () => {
    // 23:30Z and 02:00Z are two UTC days but one evening in Los Angeles.
    expect(formatEventWhen(start, end, 'America/Los_Angeles', 'en')).not.toContain('→');
    expect(formatEventWhen(start, end, 'UTC', 'en')).toContain('→');
  });

  it('falls back to UTC for a zone name it does not know', () => {
    expect(formatEventStart(start, 'Not/AZone', 'en')).toBe('Sat, May 1, 11:30 PM');
  });

  it('writes Arabic and Japanese in their own form', () => {
    expect(formatEventStart(start, 'UTC', 'ja')).toMatch(/5月1日/);
    expect(formatEventStart(start, 'UTC', 'ar')).toMatch(/مايو/);
  });
});

describe('distance and price range', () => {
  it('shows one decimal under ten kilometres, none above', () => {
    expect(formatDistance(3.4, 'en')).toBe('3.4 km');
    expect(formatDistance(42.3, 'en')).toBe('42 km');
    expect(formatDistance(3.4, 'de')).toBe('3,4 km');
  });

  it('shows Free, a price, or a range', () => {
    expect(formatPriceRange(null, null, 'EUR', 'en', 'Free')).toBeNull();
    expect(formatPriceRange(0, 0, 'EUR', 'en', 'Free')).toBe('Free');
    expect(formatPriceRange(1500, 1500, 'EUR', 'en', 'Free')).toBe('€15.00');
    expect(formatPriceRange(0, 4000, 'EUR', 'en', 'Free')).toBe('Free – €40.00');
    expect(formatPriceRange(1500, 4000, 'EUR', 'en', 'Free')).toBe('€15.00 – €40.00');
  });
});
