import { describe, expect, it } from 'vitest';
import { AnswerError } from '../src/definition.ts';
import {
  checkRsvpAnswers,
  EMPTY_RULE,
  RsvpFormDefinition,
  type RsvpGuestContext,
  rsvpVisible,
  ruleFromLogic,
  ruleToLogic,
} from '../src/rsvp.ts';

const CEREMONY = '01900000-0000-7000-8000-000000000001';
const RECEPTION = '01900000-0000-7000-8000-000000000002';
const menu = [
  { id: '01900000-0000-7000-8000-0000000000a1', label: 'Fish' },
  { id: '01900000-0000-7000-8000-0000000000a2', label: 'Vegetarian' },
];
const FISH = menu[0]?.id as string;

/** Reception meal (attending only), dietary (sealed), adults' song request, a plus-one question. */
const def = RsvpFormDefinition.parse({
  questions: [
    {
      key: 'meal',
      type: 'meal',
      label: 'Reception: meal choice',
      subEventId: RECEPTION,
      required: true,
      showIf: { '==': [{ var: 'attending' }, true] },
    },
    { key: 'dietary', type: 'long_text', label: 'Dietary needs', sensitive: true, binding: 'dietary' },
    {
      key: 'song',
      type: 'short_text',
      label: 'Ceremony: song request',
      subEventId: CEREMONY,
      showIf: { and: [{ '==': [{ var: 'attending' }, true] }, { '==': [{ var: 'age_class' }, 'adult'] }] },
    },
    {
      key: 'hotel',
      type: 'checkbox',
      label: 'Is your plus-one staying at the hotel?',
      showIf: { '==': [{ var: 'plus_one_named' }, true] },
    },
    {
      key: 'room',
      type: 'select',
      label: 'Room type',
      options: [
        { value: 'single', label: 'Single' },
        { value: 'double', label: 'Double' },
      ],
      showIf: { '==': [{ var: 'hotel' }, true] },
    },
  ],
});

const adult = (over: Partial<RsvpGuestContext> = {}): RsvpGuestContext => ({
  invited: [CEREMONY, RECEPTION],
  attending: [CEREMONY, RECEPTION],
  ageClass: 'adult',
  isPlusOne: false,
  named: true,
  plusOneNamed: false,
  ...over,
});
const keys = (g: RsvpGuestContext, answers: Record<string, unknown> = {}) =>
  rsvpVisible(def, g, answers, { menu }).map((q) => q.key);
const fail = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof AnswerError) return `${err.field}:${err.message}`;
    throw err;
  }
  return 'ok';
};

describe('rsvp definitions', () => {
  it('accepts conditions on the guest context and earlier answers only', () => {
    expect(def.questions).toHaveLength(5);
    const later = RsvpFormDefinition.safeParse({
      questions: [
        { key: 'a', type: 'short_text', label: 'A', showIf: { '==': [{ var: 'b' }, 'x'] } },
        { key: 'b', type: 'short_text', label: 'B' },
      ],
    });
    expect(later.success).toBe(false);
    const op = RsvpFormDefinition.safeParse({
      questions: [{ key: 'a', type: 'short_text', label: 'A', showIf: { map: [1] } }],
    });
    expect(op.success).toBe(false);
  });

  it('refuses reserved keys, two meals, public write-backs and private meals', () => {
    const bad = (questions: unknown[]) => RsvpFormDefinition.safeParse({ questions }).success;
    expect(bad([{ key: 'attending', type: 'short_text', label: 'X' }])).toBe(false);
    expect(
      bad([
        { key: 'm1', type: 'meal', label: 'M1' },
        { key: 'm2', type: 'meal', label: 'M2' },
      ]),
    ).toBe(false);
    expect(bad([{ key: 'd', type: 'short_text', label: 'D', binding: 'dietary' }])).toBe(false);
    expect(
      bad([
        {
          key: 'd',
          type: 'select',
          label: 'D',
          sensitive: true,
          binding: 'dietary',
          options: [{ value: 'a', label: 'A' }],
        },
      ]),
    ).toBe(false);
    expect(bad([{ key: 'm', type: 'meal', label: 'M', sensitive: true }])).toBe(false);
    expect(
      bad([
        { key: 'd1', type: 'short_text', label: 'D', sensitive: true, binding: 'dietary' },
        { key: 'd2', type: 'short_text', label: 'D', sensitive: true, binding: 'dietary' },
      ]),
    ).toBe(false);
    expect(bad([{ key: 'm', type: 'meal', label: 'M', options: [{ value: 'a', label: 'A' }] }])).toBe(false);
  });
});

describe('which questions a guest sees', () => {
  it('an attending adult sees the meal, dietary and song questions', () => {
    expect(keys(adult())).toEqual(['meal', 'dietary', 'song']);
  });

  it('a guest declining the reception gets no meal; declining everything leaves the event-wide ones', () => {
    expect(keys(adult({ attending: [CEREMONY] }))).toEqual(['dietary', 'song']);
    expect(keys(adult({ attending: [] }))).toEqual(['dietary']);
  });

  it('children get no song request; questions follow the invitations', () => {
    expect(keys(adult({ ageClass: 'child' }))).toEqual(['meal', 'dietary']);
    expect(keys(adult({ invited: [CEREMONY], attending: [CEREMONY] }))).toEqual(['dietary', 'song']);
  });

  it('a named plus-one brings the hotel question, and its answer the room question', () => {
    expect(keys(adult({ plusOneNamed: true }))).toEqual(['meal', 'dietary', 'song', 'hotel']);
    expect(keys(adult({ plusOneNamed: true }), { hotel: true })).toEqual([
      'meal',
      'dietary',
      'song',
      'hotel',
      'room',
    ]);
  });

  it('unnamed plus-ones, uninvited guests and an empty menu hide questions', () => {
    expect(keys(adult({ isPlusOne: true, named: false }))).toEqual([]);
    expect(keys(adult({ invited: [], attending: [] }))).toEqual([]);
    expect(rsvpVisible(def, adult(), {}, { menu: [] }).map((q) => q.key)).toEqual(['dietary', 'song']);
  });
});

describe('server check', () => {
  it('normalizes visible answers and requires required ones', () => {
    const r = checkRsvpAnswers(def, adult(), { meal: FISH, dietary: ' No nuts ', song: 'Abba' }, { menu });
    expect(r.answers).toEqual({ meal: FISH, dietary: 'No nuts', song: 'Abba' });
    expect(fail(() => checkRsvpAnswers(def, adult(), {}, { menu }))).toBe('meal:Required');
    expect(fail(() => checkRsvpAnswers(def, adult(), { meal: 'steak' }, { menu }))).toBe(
      'meal:Choose an option',
    );
  });

  it('rejects answers to hidden questions, naming the question; blank ones are harmless', () => {
    const declined = adult({ attending: [CEREMONY] });
    expect(fail(() => checkRsvpAnswers(def, declined, { meal: FISH }, { menu }))).toBe(
      'meal:Not on your path',
    );
    expect(
      fail(() => checkRsvpAnswers(def, adult({ ageClass: 'child' }), { meal: FISH, song: 'x' }, { menu })),
    ).toBe('song:Not on your path');
    expect(fail(() => checkRsvpAnswers(def, adult(), { meal: FISH, room: 'single' }, { menu }))).toBe(
      'room:Not on your path',
    );
    expect(fail(() => checkRsvpAnswers(def, adult(), { meal: FISH, nope: 'x' }, { menu }))).toBe(
      'nope:Unknown question',
    );
    expect(checkRsvpAnswers(def, declined, { meal: '', song: '', hotel: false }, { menu }).answers).toEqual(
      {},
    );
  });

  it('an answer that fails validation on a hidden question is reported as hidden', () => {
    expect(fail(() => checkRsvpAnswers(def, adult({ attending: [] }), { meal: 'steak' }, { menu }))).toBe(
      'meal:Not on your path',
    );
  });

  it('a private answer given before may be left blank (kept); write-backs are capped at 500', () => {
    const req = RsvpFormDefinition.parse({
      questions: [
        {
          key: 'access',
          type: 'long_text',
          label: 'Access',
          sensitive: true,
          binding: 'accessibility',
          required: true,
        },
      ],
    });
    expect(fail(() => checkRsvpAnswers(req, adult(), {}, { menu }))).toBe('access:Required');
    expect(checkRsvpAnswers(req, adult(), {}, { menu, keep: new Set(['access']) }).answers).toEqual({});
    expect(fail(() => checkRsvpAnswers(req, adult(), { access: 'x'.repeat(501) }, { menu }))).toBe(
      'access:Too long',
    );
  });

  it('the hotel answer opens the room question on the server too', () => {
    const g = adult({ plusOneNamed: true });
    expect(checkRsvpAnswers(def, g, { meal: FISH, hotel: 'on', room: 'double' }, { menu }).answers).toEqual({
      meal: FISH,
      hotel: true,
      room: 'double',
    });
    expect(
      fail(() => checkRsvpAnswers(def, g, { meal: FISH, hotel: 'false', room: 'double' }, { menu })),
    ).toBe('room:Not on your path');
  });
});

describe('builder rules ↔ conditions', () => {
  const earlier = def.questions;
  it('round-trips every rule the builder offers', () => {
    const rules = [
      EMPTY_RULE,
      { ...EMPTY_RULE, attending: true },
      { ...EMPTY_RULE, adultsOnly: true, plusOneNamed: true },
      { ...EMPTY_RULE, attending: true, answer: { key: 'room', value: 'double' } },
      { ...EMPTY_RULE, answer: { key: 'hotel', value: 'true' } },
    ];
    for (const rule of rules) expect(ruleFromLogic(ruleToLogic(rule, earlier))).toEqual(rule);
    expect(ruleToLogic(EMPTY_RULE, earlier)).toBeNull();
    expect(ruleToLogic({ ...EMPTY_RULE, attending: true }, earlier)).toEqual({
      '==': [{ var: 'attending' }, true],
    });
  });

  it('a multi-choice answer becomes `in`; other shapes read as custom (null)', () => {
    const multi = [{ key: 'diet', type: 'multi_select' as const }];
    const logic = ruleToLogic({ ...EMPTY_RULE, answer: { key: 'diet', value: 'vegan' } }, multi);
    expect(logic).toEqual({ in: ['vegan', { var: 'diet' }] });
    expect(ruleFromLogic(logic)).toEqual({ ...EMPTY_RULE, answer: { key: 'diet', value: 'vegan' } });
    expect(ruleFromLogic({ or: [{ var: 'a' }, { var: 'b' }] })).toBeNull();
    expect(ruleFromLogic({ '>': [{ var: 'n' }, 2] })).toBeNull();
  });
});
