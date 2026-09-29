import { describe, expect, it } from 'vitest';
import { AnswerError, checkAnswers, FormDefinition } from '../src/definition.ts';
import {
  checkRegistrationAnswers,
  computePath,
  RegistrationFormDefinition,
  respondentPage,
  visibleOnPage,
} from '../src/registration.ts';

const MEMBER = 'type-member';
const STUDENT = 'type-student';
const EXHIBITOR = 'type-exhibitor';

/** Three pages: details for all, a member page, and a workshop page behind a page-1 answer. */
const def = RegistrationFormDefinition.parse({
  pages: [
    {
      key: 'details',
      title: 'Your details',
      fields: [
        { key: 'company', type: 'company', label: 'Company', required: true },
        { key: 'job', type: 'job_title', label: 'Job title' },
        { key: 'workshops', type: 'checkbox', label: 'Joining workshops?' },
        {
          key: 'badge_name',
          type: 'short_text',
          label: 'Name on badge',
          showIf: { '==': [{ var: 'workshops' }, true] },
        },
        {
          key: 'school',
          type: 'short_text',
          label: 'School',
          required: true,
          registrationTypes: [STUDENT],
        },
      ],
    },
    {
      key: 'membership',
      title: 'Membership',
      registrationTypes: [MEMBER],
      fields: [{ key: 'member_no', type: 'short_text', label: 'Member number', required: true }],
    },
    {
      key: 'sessions',
      title: 'Workshops',
      showIf: { '==': [{ var: 'workshops' }, true] },
      fields: [
        {
          key: 'track',
          type: 'select',
          label: 'Track',
          required: true,
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
        { key: 'diet', type: 'long_text', label: 'Diet', sensitive: true },
        {
          key: 'share_email',
          type: 'consent',
          label: 'Exhibitors may receive my email',
          consent: { term: 'exhibitor_email_sharing', version: 1 },
        },
      ],
    },
  ],
});

const keys = (p: ReturnType<typeof computePath>) => p.map((x) => x.page.key);

describe('registration form definition', () => {
  it('parses pages with per-type limits and the new field types', () => {
    expect(def.pages).toHaveLength(3);
    expect(def.pages[1]?.registrationTypes).toEqual([MEMBER]);
    expect(def.pages[2]?.fields[2]?.consent).toEqual({ term: 'exhibitor_email_sharing', version: 1 });
  });

  it('refuses conditions on later or unknown questions', () => {
    const later = RegistrationFormDefinition.safeParse({
      pages: [
        { key: 'one', title: 'One', showIf: { var: 'x' }, fields: [] },
        { key: 'two', title: 'Two', fields: [{ key: 'x', type: 'checkbox', label: 'X' }] },
      ],
    });
    expect(later.success).toBe(false);
    const samePageLater = RegistrationFormDefinition.safeParse({
      pages: [
        {
          key: 'one',
          title: 'One',
          fields: [
            { key: 'a', type: 'checkbox', label: 'A', showIf: { var: 'b' } },
            { key: 'b', type: 'checkbox', label: 'B' },
          ],
        },
      ],
    });
    expect(samePageLater.success).toBe(false);
  });

  it('refuses duplicate keys across pages, required or private consent, and consent without a term', () => {
    const dup = RegistrationFormDefinition.safeParse({
      pages: [
        { key: 'one', title: 'One', fields: [{ key: 'a', type: 'checkbox', label: 'A' }] },
        { key: 'two', title: 'Two', fields: [{ key: 'a', type: 'checkbox', label: 'A' }] },
      ],
    });
    expect(dup.success).toBe(false);
    const consent = (extra: object) =>
      RegistrationFormDefinition.safeParse({
        pages: [{ key: 'one', title: 'One', fields: [{ key: 'c', type: 'consent', label: 'C', ...extra }] }],
      }).success;
    const term = { consent: { term: 'exhibitor_email_sharing', version: 1 } };
    expect(consent(term)).toBe(true);
    expect(consent({})).toBe(false);
    expect(consent({ ...term, required: true })).toBe(false);
    expect(consent({ ...term, sensitive: true })).toBe(false);
    expect(
      RegistrationFormDefinition.safeParse({
        pages: [{ key: 'one', title: 'One', fields: [{ key: 'c', type: 'checkbox', label: 'C', ...term }] }],
      }).success,
    ).toBe(false);
  });

  it('refuses a form with no pages and unknown registration type ids', () => {
    expect(RegistrationFormDefinition.safeParse({ pages: [] }).success).toBe(false);
    expect(
      RegistrationFormDefinition.safeParse({
        pages: [{ key: 'one', title: 'One', registrationTypes: ['bad id!'], fields: [] }],
      }).success,
    ).toBe(false);
  });
});

describe('path computation', () => {
  it('computes the path per registration type', () => {
    expect(keys(computePath(def, MEMBER, {}))).toEqual(['details', 'membership']);
    expect(keys(computePath(def, STUDENT, {}))).toEqual(['details']);
    expect(keys(computePath(def, EXHIBITOR, {}))).toEqual(['details']);
    // A question limited to a type is only on that type's path.
    const fieldsOf = (t: string) => computePath(def, t, {})[0]?.fields.map((f) => f.key);
    expect(fieldsOf(STUDENT)).toContain('school');
    expect(fieldsOf(MEMBER)).not.toContain('school');
  });

  it('opens a page from an answer on an earlier page (cross-page condition)', () => {
    expect(keys(computePath(def, EXHIBITOR, { workshops: true }))).toEqual(['details', 'sessions']);
    expect(keys(computePath(def, MEMBER, { workshops: true }))).toEqual(['details', 'membership', 'sessions']);
    expect(keys(computePath(def, MEMBER, { workshops: false }))).toEqual(['details', 'membership']);
  });

  it('skips a page with no visible question', () => {
    const d = RegistrationFormDefinition.parse({
      pages: [
        { key: 'one', title: 'One', fields: [{ key: 'a', type: 'checkbox', label: 'A' }] },
        {
          key: 'two',
          title: 'Two',
          fields: [{ key: 'b', type: 'short_text', label: 'B', registrationTypes: [MEMBER] }],
        },
        { key: 'three', title: 'Empty', fields: [] },
      ],
    });
    expect(keys(computePath(d, STUDENT, {}))).toEqual(['one']);
    expect(keys(computePath(d, MEMBER, {}))).toEqual(['one', 'two']);
  });
});

describe('server validation (registration kind)', () => {
  const ok = { company: 'Acme', job: 'Engineer' };

  it('validates exactly the path and returns it', () => {
    const r = checkRegistrationAnswers(def, { ...ok, member_no: 'M-1' }, { registrationTypeId: MEMBER });
    expect(r.path.map((p) => p.page)).toEqual(['details', 'membership']);
    expect(r.answers).toEqual({ company: 'Acme', job: 'Engineer', member_no: 'M-1' });
  });

  it('enforces required questions on visible pages only', () => {
    const missing = () => checkRegistrationAnswers(def, ok, { registrationTypeId: MEMBER });
    expect(missing).toThrow(AnswerError);
    expect(() => missing()).toThrow('Required');
    // The member page is not on a student's path; the student's school is.
    expect(() => checkRegistrationAnswers(def, ok, { registrationTypeId: STUDENT })).toThrow('Required');
    expect(
      checkRegistrationAnswers(def, { ...ok, school: 'State U' }, { registrationTypeId: STUDENT }).path,
    ).toHaveLength(1);
    // Saving a draft enforces nothing required.
    expect(checkRegistrationAnswers(def, {}, { registrationTypeId: MEMBER, requirePages: [] }).answers).toEqual(
      {},
    );
  });

  it('rejects (never drops) answers on hidden pages and questions, naming the question', () => {
    const reject = (answers: Record<string, unknown>, type: string) => {
      try {
        checkRegistrationAnswers(def, answers, { registrationTypeId: type });
      } catch (e) {
        return e instanceof AnswerError ? [e.field, e.message] : ['?', String(e)];
      }
      return null;
    };
    // A member-only page answered by an exhibitor.
    expect(reject({ ...ok, member_no: 'M-1' }, EXHIBITOR)).toEqual(['member_no', 'Not on your path']);
    // A page hidden by a cross-page condition.
    expect(reject({ ...ok, workshops: false, track: 'a' }, EXHIBITOR)).toEqual(['track', 'Not on your path']);
    // A question for another type on a visible page.
    expect(reject({ ...ok, member_no: 'M-1', school: 'X' }, MEMBER)).toEqual(['school', 'Not on your path']);
    // A question behind a false condition on the same page.
    expect(reject({ ...ok, badge_name: 'Al' }, EXHIBITOR)).toEqual(['badge_name', 'Not on your path']);
    // Unknown keys.
    expect(reject({ ...ok, nope: 1 }, EXHIBITOR)).toEqual(['nope', 'Unknown question']);
    // Blank values for hidden questions are not answers.
    expect(reject({ ...ok, badge_name: '', track: null, share_email: false }, EXHIBITOR)).toBeNull();
  });

  it('drops only the stored answers it is told it may drop', () => {
    const r = checkRegistrationAnswers(
      def,
      { ...ok, track: 'a' },
      { registrationTypeId: EXHIBITOR, dropHidden: (k) => k === 'track' },
    );
    expect(r.answers).toEqual(ok);
  });

  it('normalizes company and job title text and caps their length', () => {
    const r = checkRegistrationAnswers(
      def,
      { company: '  Acme   Corp ', job: ' Head  of  Events ' },
      { registrationTypeId: EXHIBITOR },
    );
    expect(r.answers).toEqual({ company: 'Acme Corp', job: 'Head of Events' });
    expect(() =>
      checkRegistrationAnswers(def, { company: 'x'.repeat(201) }, { registrationTypeId: EXHIBITOR }),
    ).toThrow('Too long');
    expect(() => checkRegistrationAnswers(def, { company: 3 }, { registrationTypeId: EXHIBITOR })).toThrow(
      'Text expected',
    );
  });

  it('maps checked consent boxes to their ledger term and version; unchecked maps to nothing', () => {
    const base = { ...ok, workshops: true, track: 'b' };
    const yes = checkRegistrationAnswers(def, { ...base, share_email: 'on' }, { registrationTypeId: EXHIBITOR });
    expect(yes.consents).toEqual([{ key: 'share_email', term: 'exhibitor_email_sharing', version: 1 }]);
    expect(yes.answers.share_email).toBe(true);
    const no = checkRegistrationAnswers(def, { ...base, share_email: false }, { registrationTypeId: EXHIBITOR });
    expect(no.consents).toEqual([]);
    const unanswered = checkRegistrationAnswers(def, base, { registrationTypeId: EXHIBITOR });
    expect(unanswered.consents).toEqual([]);
    expect(() =>
      checkRegistrationAnswers(def, { ...base, share_email: 'maybe' }, { registrationTypeId: EXHIBITOR }),
    ).toThrow('Checkbox expected');
  });

  it('leaves the checkout-questions kind unchanged (hidden answers are still dropped there)', () => {
    const checkout = FormDefinition.parse({
      fields: [
        { key: 'kids', type: 'checkbox', label: 'Kids?' },
        { key: 'count', type: 'count', label: 'How many?', showIf: { '==': [{ var: 'kids' }, true] } },
      ],
    });
    expect(checkAnswers(checkout, { kids: false, count: 3 })).toEqual({ kids: false });
  });
});

describe('respondent page payload', () => {
  it('carries only the page on the path, with this type’s questions', () => {
    expect(respondentPage(def, EXHIBITOR, {}, 'membership')).toBeNull();
    expect(respondentPage(def, EXHIBITOR, {}, 'sessions')).toBeNull();
    const details = respondentPage(def, MEMBER, {}, 'details');
    expect(details?.fields.map((f) => f.key)).toEqual(['company', 'job', 'workshops', 'badge_name']);
    // The same-page condition stays for the browser to evaluate.
    expect(details?.fields[3]?.showIf).not.toBeNull();
    expect(visibleOnPage(details!, { workshops: false }).map((f) => f.key)).not.toContain('badge_name');
    expect(visibleOnPage(details!, { workshops: true }).map((f) => f.key)).toContain('badge_name');
  });

  it('decides conditions on earlier pages on the server and sends the context they read', () => {
    const d = RegistrationFormDefinition.parse({
      pages: [
        { key: 'one', title: 'One', fields: [{ key: 'a', type: 'checkbox', label: 'A' }] },
        {
          key: 'two',
          title: 'Two',
          fields: [
            { key: 'b', type: 'short_text', label: 'B', showIf: { '==': [{ var: 'a' }, true] } },
            { key: 'c', type: 'checkbox', label: 'C' },
            {
              key: 'd',
              type: 'short_text',
              label: 'D',
              showIf: { and: [{ var: 'a' }, { var: 'c' }] },
            },
          ],
        },
      ],
    });
    const hidden = respondentPage(d, MEMBER, { a: false }, 'two');
    expect(hidden?.fields.map((f) => f.key)).toEqual(['c', 'd']);
    const shown = respondentPage(d, MEMBER, { a: true }, 'two');
    expect(shown?.fields.map((f) => f.key)).toEqual(['b', 'c', 'd']);
    expect(shown?.fields[0]?.showIf).toBeNull();
    expect(shown?.context).toEqual({ a: true });
    expect(visibleOnPage(shown!, { c: true }).map((f) => f.key)).toEqual(['b', 'c', 'd']);
  });
});

/** Deterministic PRNG so a failing case can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('property: the server path equals the client path', () => {
  const TYPES = [MEMBER, STUDENT, EXHIBITOR, 'type-vip'];
  const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

  /** A random well-formed form: pages and questions with random type limits and conditions. */
  function randomForm(r: () => number) {
    const pages = [];
    const earlier: { key: string; type: string }[] = [];
    const cond = () => {
      if (earlier.length === 0 || r() < 0.5) return null;
      const q = pick(r, earlier);
      if (q.type === 'checkbox') return { '==': [{ var: q.key }, r() < 0.5] };
      if (q.type === 'select') return { '!=': [{ var: q.key }, pick(r, ['x', 'y'])] };
      return { '>': [{ var: q.key }, Math.floor(r() * 5)] };
    };
    const types = () => (r() < 0.6 ? null : TYPES.filter(() => r() < 0.5).slice(0, 3));
    let n = 0;
    for (let p = 0; p < 1 + Math.floor(r() * 5); p++) {
      const pageIf = p > 0 ? cond() : null;
      const fields = [];
      for (let f = 0; f < Math.floor(r() * 4); f++) {
        const type = pick(r, ['checkbox', 'select', 'count']);
        const key = `q${n++}`;
        const t = types();
        fields.push({
          key,
          type,
          label: key,
          showIf: cond(),
          registrationTypes: t && t.length > 0 ? t : null,
          options: type === 'select' ? [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] : [],
        });
        earlier.push({ key, type });
      }
      const t = types();
      pages.push({
        key: `p${p}`,
        title: `P${p}`,
        showIf: pageIf,
        registrationTypes: t && t.length > 0 ? t : null,
        fields,
      });
    }
    return RegistrationFormDefinition.parse({ pages });
  }

  it('for random forms, types and answer sets', () => {
    const r = rng(20260929);
    for (let run = 0; run < 1500; run++) {
      const d = randomForm(r);
      const typeId = pick(r, TYPES);
      // Random typed answers to any question (visible or not), as a browser might hold them.
      const raw: Record<string, unknown> = {};
      for (const p of d.pages)
        for (const f of p.fields) {
          if (r() < 0.3) continue;
          raw[f.key] =
            f.type === 'checkbox' ? r() < 0.5 : f.type === 'select' ? pick(r, ['x', 'y']) : Math.floor(r() * 6);
        }
      const client = computePath(d, typeId, raw);
      // The client submits only what its path shows.
      const shown = new Set(client.flatMap((p) => p.fields.map((f) => f.key)));
      const submitted = Object.fromEntries(Object.entries(raw).filter(([k]) => shown.has(k)));
      const server = checkRegistrationAnswers(d, submitted, { registrationTypeId: typeId, requirePages: [] });
      expect(server.path).toEqual(client.map((p) => ({ page: p.page.key, fields: p.fields.map((f) => f.key) })));
      // Anything the client did not show is refused when it carries an answer.
      const hidden = Object.entries(raw).find(([k, v]) => !shown.has(k) && v !== false);
      if (hidden)
        expect(() =>
          checkRegistrationAnswers(d, { ...submitted, [hidden[0]]: hidden[1] }, { registrationTypeId: typeId }),
        ).toThrow('Not on your path');
    }
  });
});
