import { describe, expect, it } from 'vitest';
import {
  averageScore,
  cfpOpenness,
  checkCoSpeakers,
  draftSessionTimes,
  forReviewer,
} from '../src/domain/cfp.ts';

const now = new Date('2029-03-01T12:00:00Z');

describe('cfpOpenness', () => {
  it('a missing or draft call takes nothing and is not public', () => {
    expect(cfpOpenness(null, now)).toBe('not_open');
    expect(cfpOpenness({ status: 'draft', closesAt: null }, now)).toBe('not_open');
  });
  it('open until closed or until the deadline (exclusive)', () => {
    expect(cfpOpenness({ status: 'open', closesAt: null }, now)).toBe('open');
    expect(cfpOpenness({ status: 'open', closesAt: new Date(now.getTime() + 1) }, now)).toBe('open');
    expect(cfpOpenness({ status: 'open', closesAt: now }, now)).toBe('past_deadline');
    expect(cfpOpenness({ status: 'closed', closesAt: null }, now)).toBe('closed');
  });
});

describe('checkCoSpeakers', () => {
  it('trims, lowercases and keeps the order', () => {
    expect(
      checkCoSpeakers(
        [
          { name: ' Ana ', email: ' Ana@Example.test ' },
          { name: 'Ben', email: 'ben@example.test' },
        ],
        'lead@example.test',
        3,
      ),
    ).toEqual({
      ok: true,
      coSpeakers: [
        { name: 'Ana', email: 'ana@example.test' },
        { name: 'Ben', email: 'ben@example.test' },
      ],
    });
  });
  it('refuses more than allowed, repeats and the submitter themselves', () => {
    const two = [
      { name: 'A', email: 'a@x.test' },
      { name: 'B', email: 'b@x.test' },
    ];
    expect(checkCoSpeakers(two, 'lead@x.test', 1)).toEqual({ ok: false, reason: 'too_many', index: 1 });
    expect(checkCoSpeakers(two, 'lead@x.test', 0)).toEqual({ ok: false, reason: 'too_many', index: 0 });
    expect(checkCoSpeakers([...two, { name: 'A2', email: 'A@x.test' }], 'lead@x.test', 5)).toEqual({
      ok: false,
      reason: 'duplicate',
      index: 2,
    });
    expect(checkCoSpeakers([{ name: 'Me', email: 'LEAD@x.test' }], 'lead@x.test', 5)).toEqual({
      ok: false,
      reason: 'duplicate',
      index: 0,
    });
  });
});

describe('averageScore', () => {
  it('is null with no review and rounds to one decimal', () => {
    expect(averageScore([])).toBeNull();
    expect(averageScore([4, 5])).toBe(4.5);
    expect(averageScore([1, 2, 2])).toBe(1.7);
  });
});

describe('draftSessionTimes', () => {
  const event = { startsAt: new Date('2029-06-01T14:00:00Z'), endsAt: new Date('2029-06-01T16:00:00Z') };
  it('starts at the event start for the requested length', () => {
    expect(draftSessionTimes(event, 45)).toEqual({
      startsAt: event.startsAt,
      endsAt: new Date('2029-06-01T14:45:00Z'),
    });
  });
  it('never runs past the event end', () => {
    expect(draftSessionTimes(event, 480).endsAt).toEqual(event.endsAt);
  });
});

describe('forReviewer', () => {
  const view = {
    speakerName: 'Lea',
    speakerTitle: 'Researcher',
    speakerCompany: 'Acme',
    speakerBio: 'Bio',
    coSpeakers: [{ name: 'Cora' }],
    answers: [{ label: 'City', value: 'Lisbon' }],
  };
  it('shows everything without blind review', () => {
    expect(forReviewer(view, false)).toEqual(view);
  });
  it('hides every person-identifying field under blind review', () => {
    const blind = forReviewer(view, true);
    expect(blind).toEqual({
      speakerName: null,
      speakerTitle: null,
      speakerCompany: null,
      speakerBio: null,
      coSpeakers: [],
      answers: [],
    });
    expect(JSON.stringify(blind)).not.toMatch(/Lea|Acme|Cora|Lisbon/);
  });
});
