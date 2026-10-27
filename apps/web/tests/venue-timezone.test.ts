import { describe, expect, it } from 'vitest';
import { guessVenueZone } from '../src/lib/venue-timezone.ts';
import { zoneLabel } from '../src/lib/zone-label.ts';

describe('venue time zone', () => {
  it('follows the country, and the city in multi-zone countries', () => {
    expect(guessVenueZone('IN', 'Mumbai')).toEqual({ zone: 'Asia/Kolkata', certain: true });
    expect(guessVenueZone('us', 'Los Angeles')).toEqual({ zone: 'America/Los_Angeles', certain: true });
    expect(guessVenueZone('US', 'Springfield')).toEqual({ zone: 'America/New_York', certain: false });
    expect(guessVenueZone('ZZ', null)).toBeNull();
  });

  it('shows a readable zone name, never the raw identifier', () => {
    expect(zoneLabel('Asia/Kolkata', 'en')).toBe('India Standard Time');
    expect(zoneLabel('America/New_York', 'en')).not.toContain('/');
  });
});
