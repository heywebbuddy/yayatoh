import { describe, expect, it } from 'vitest';
import { cleanEventSetupDraft } from '../src/domain/event-setup.ts';
import { ruleBasedSetup } from '../src/domain/event-setup-rules.ts';
import { guessTimeZone, timeZoneLabel } from '../src/domain/timezone.ts';

const PROFILES = ['conference', 'tour', 'concert', 'other'];

describe('time zones in AI text', () => {
  it('names a zone in words and reads a city', () => {
    expect(timeZoneLabel('Asia/Kolkata')).toBe('India Standard Time');
    expect(timeZoneLabel('America/New_York')).toMatch(/Eastern/);
    expect(guessTimeZone('A food walk in Hyderabad')).toBe('Asia/Kolkata');
    expect(guessTimeZone('Goanna safari')).toBeNull();
  });

  it('puts a Hyderabad event on its own zone, not the organization default', () => {
    const d = ruleBasedSetup('A two-day developer conference in Hyderabad', '2030-01-01', PROFILES);
    expect(d.timezone).toBe('Asia/Kolkata');
  });
});

describe('Create with AI completeness', () => {
  it('gives every day of a multi-day event its own agenda', () => {
    const d = ruleBasedSetup('A three-day developer conference in Pune', '2030-01-01', PROFILES);
    const days = new Set(d.agenda.map((a) => a.startsLocal.slice(0, 10)));
    expect(days.size).toBe(3);
    expect(d.agenda.some((a) => a.title.startsWith('Day 3'))).toBe(true);
  });

  it('turns "daily" into a repeating schedule and named pickups into pickup points', () => {
    const d = ruleBasedSetup(
      'Daily city walking tour in Hyderabad with pickups at Hitech City metro, Charminar and Banjara Hills',
      '2030-01-01',
      PROFILES,
    );
    expect(d.profile).toBe('tour');
    expect(d.repeatDays).toBe(14);
    expect(d.pickups).toEqual(['Hitech City metro', 'Charminar', 'Banjara Hills']);
  });

  it('keeps the model’s zone, repeat and pickups only when they are valid and for a tour', () => {
    const raw = JSON.stringify({
      name: 'Old Town Walk',
      profile: 'tour',
      startsLocal: '2030-03-01 09:00',
      city: 'Hyderabad',
      timezone: 'Asia/Kolkata',
      repeatDays: 7,
      pickups: ['Charminar', 'Charminar', ' '],
    });
    const d = cleanEventSetupDraft(raw, { today: '2030-01-01', profiles: PROFILES, brief: '' });
    expect(d.timezone).toBe('Asia/Kolkata');
    expect(d.repeatDays).toBe(7);
    expect(d.pickups).toEqual(['Charminar']);
    const c = cleanEventSetupDraft(raw.replace('"tour"', '"concert"').replace('Asia/Kolkata', 'Nope/Zone'), {
      today: '2030-01-01',
      profiles: PROFILES,
      brief: 'at Hyderabad',
    });
    expect(c.repeatDays).toBe(0);
    expect(c.pickups).toEqual([]);
    expect(c.timezone).toBe('Asia/Kolkata');
  });
});
