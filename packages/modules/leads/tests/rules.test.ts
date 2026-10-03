import { describe, expect, it } from 'vitest';
import {
  accessOpen,
  CAPTURE_CLOSES_AFTER_MS,
  canSeeLead,
  captureState,
  captureTime,
  captureWindow,
  mergeNotes,
  normalizeQualifiers,
  pickQualifiers,
  sharedFields,
} from '../src/domain/rules.ts';

const event = { startsAt: new Date('2026-11-10T09:00:00Z'), endsAt: new Date('2026-11-12T18:00:00Z') };
const w = captureWindow(event);

describe('capture window (P5-4)', () => {
  it('opens 24 h before the start and closes 48 h after the end', () => {
    expect(w.opensAt.toISOString()).toBe('2026-11-09T09:00:00.000Z');
    expect(w.closesAt.toISOString()).toBe('2026-11-14T18:00:00.000Z');
    expect(w.accessUntil.toISOString()).toBe('2027-02-10T18:00:00.000Z');
  });

  it('is not open before, open inside, and closed from the closing instant', () => {
    expect(captureState(w, new Date('2026-11-09T08:59:59Z'))).toBe('not_open');
    expect(captureState(w, new Date('2026-11-09T09:00:00Z'))).toBe('open');
    expect(captureState(w, new Date(w.closesAt.getTime() - 1))).toBe('open');
    expect(captureState(w, w.closesAt)).toBe('closed');
    expect(captureState(w, new Date(event.endsAt.getTime() + CAPTURE_CLOSES_AFTER_MS + 60_000))).toBe(
      'closed',
    );
  });

  it('keeps notes and export open for 90 days after the event', () => {
    expect(accessOpen(w, new Date('2027-02-10T17:59:59Z'))).toBe(true);
    expect(accessOpen(w, new Date('2027-02-10T18:00:00Z'))).toBe(false);
  });
});

describe('capture time of an offline scan', () => {
  const received = new Date('2026-11-15T10:00:00Z');
  it('keeps the device time (a scan made before closing still counts when it syncs later)', () => {
    const at = new Date('2026-11-14T17:00:00Z');
    expect(captureTime(at, received)).toEqual(at);
    expect(captureState(w, captureTime(at, received))).toBe('open');
  });
  it('replaces a device time in the future with the time received', () => {
    expect(captureTime(new Date('2026-11-15T10:06:00Z'), received)).toEqual(received);
    expect(captureTime(new Date('2026-11-15T10:04:00Z'), received).toISOString()).toBe(
      '2026-11-15T10:04:00.000Z',
    );
  });
});

describe('what a scan shares (P5-8)', () => {
  it('never shares email without consent, and never phone or address', () => {
    expect(sharedFields(false)).toEqual(['name', 'job_title', 'company']);
    expect(sharedFields(true)).toEqual(['name', 'job_title', 'company', 'email']);
    expect(sharedFields(true)).not.toContain('phone');
  });
});

describe('qualifiers and notes', () => {
  it('normalizes labels and keeps only defined ones, in the defined order', () => {
    expect(normalizeQualifiers([' Budget ', 'budget', 'Decision  maker', ''])).toEqual([
      'Budget',
      'Decision maker',
    ]);
    expect(pickQualifiers(['Budget', 'Demo', 'Partner'], ['partner', 'BUDGET', 'Unknown'])).toEqual([
      'Budget',
      'Partner',
    ]);
  });
  it('adds offline notes on a new line once', () => {
    expect(mergeNotes('', ' met at booth ')).toBe('met at booth');
    expect(mergeNotes('first', 'second')).toBe('first\nsecond');
    expect(mergeNotes('first\nsecond', 'second')).toBe('first\nsecond');
    expect(mergeNotes('first', '  ')).toBe('first');
  });
});

describe('own vs team visibility', () => {
  it('admins see all, staff their own unless the team shares', () => {
    expect(canSeeLead({ admin: true, teamVisibility: false, scannedByMe: false })).toBe(true);
    expect(canSeeLead({ admin: false, teamVisibility: false, scannedByMe: false })).toBe(false);
    expect(canSeeLead({ admin: false, teamVisibility: false, scannedByMe: true })).toBe(true);
    expect(canSeeLead({ admin: false, teamVisibility: true, scannedByMe: false })).toBe(true);
  });
});
