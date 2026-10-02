import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { axeTag, buildVpat, parseCriteria, testsFromReport, vpatMarkdown } from '../src/vpat.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const criteria = () => parseCriteria(readFileSync(join(ROOT, 'compliance/vpat/wcag22.yaml'), 'utf8'));
const fixture = () =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/playwright-report.json'), 'utf8'));
const NOW = new Date('2026-09-29T12:00:00Z');
const vpat = () => buildVpat(criteria(), testsFromReport(fixture()), NOW);
const row = (id: string) => {
  const r = vpat().criteria.find((c) => c.id === id);
  if (!r) throw new Error(`no ${id}`);
  return r;
};

describe('WCAG 2.2 criteria (compliance/vpat/wcag22.yaml)', () => {
  it('lists every Level A and AA criterion of WCAG 2.2 once (55; 4.1.1 is obsolete)', () => {
    const c = criteria().criteria;
    expect(c).toHaveLength(55);
    expect(new Set(c.map((x) => x.id)).size).toBe(55);
    expect(c.filter((x) => x.level === 'A')).toHaveLength(31);
    expect(c.filter((x) => x.level === 'AA')).toHaveLength(24);
    expect(c.map((x) => x.id)).not.toContain('4.1.1');
    for (const id of ['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8'])
      expect(c.map((x) => x.id)).toContain(id);
  });

  it('gives every not-applicable criterion a reason', () => {
    for (const c of criteria().criteria.filter((x) => x.coverage === 'not_applicable'))
      expect(c.remark, c.id).toBeTruthy();
  });

  it('rejects a criterion naming an unknown signal', () => {
    const doc = criteria();
    const bad = { ...doc, criteria: [{ ...doc.criteria[0], signals: ['telepathy'] }] };
    expect(() => parseCriteria(stringify(bad))).toThrow(/unknown signal telepathy/);
  });

  it("maps a criterion to axe's own tag", () => {
    expect(axeTag('1.4.3')).toBe('wcag143');
    expect(axeTag('2.4.11')).toBe('wcag2411');
  });
});

describe('VPAT draft from a fixture Playwright report', () => {
  it('reads tests, projects, verdicts and axe attachments (other attachments ignored)', () => {
    const tests = testsFromReport(fixture());
    expect(tests).toHaveLength(7);
    expect(tests.map((t) => t.title)).toContain('Arabic › the settings page renders right to left');
    expect(tests.filter((t) => t.axe.length > 0)).toHaveLength(6);
    expect(vpat().source).toEqual({
      tests: 7,
      testsWithAxe: 6,
      axeScans: 6,
      projects: ['desktop-1280', 'mobile-375', 'tablet-768'],
      failedTests: 1,
    });
  });

  it('Supports: an automated criterion whose axe rules pass everywhere', () => {
    expect(row('2.4.2')).toMatchObject({ status: 'Supports', confidence: 'automated' });
    expect(row('2.4.2').axeRules).toEqual([{ id: 'document-title', passes: 6, failures: 0, advisories: 0 }]);
    expect(row('2.4.2').remarks).not.toMatch(/manual/i);
  });

  it('Supports, flagged for manual confirmation: partial criteria with passing evidence', () => {
    expect(row('2.5.8')).toMatchObject({ status: 'Supports', confidence: 'partial' });
    expect(row('2.5.8').remarks).toMatch(/confirm by manual review/);
    // Arabic RTL suite + valid-lang
    expect(row('3.1.2')).toMatchObject({ status: 'Supports' });
    expect(row('3.1.2').tests.examples).toEqual([
      'settings.spec.ts: Arabic › the settings page renders right to left',
    ]);
    // Tests in the 375 px project (skipped ones don't count)
    expect(row('1.3.4').tests).toMatchObject({ passed: 1, failed: 0 });
  });

  it('Partially Supports: a serious axe violation, named with its count', () => {
    expect(row('1.4.3').status).toBe('Partially Supports');
    expect(row('1.4.3').remarks).toContain('color-contrast (1)');
  });

  it('Partially Supports: a failing keyboard test fails every criterion that relies on it', () => {
    for (const id of ['2.1.1', '2.1.2', '2.4.3', '2.4.7', '2.5.7']) {
      expect(row(id).status, id).toBe('Partially Supports');
      expect(row(id).remarks, id).toContain('keyboard only: edit and save the settings');
    }
    expect(row('2.1.1').tests).toMatchObject({ passed: 2, failed: 1 });
  });

  it('Not Applicable with the reason and an owner check; Not Evaluated where only people can judge', () => {
    expect(row('1.2.1')).toMatchObject({ status: 'Not Applicable' });
    expect(row('1.2.1').remarks).toMatch(/Owner to confirm/);
    expect(row('1.4.4')).toMatchObject({ status: 'Not Evaluated', confidence: 'manual' });
    expect(row('1.4.4').remarks).toMatch(/Zoom to 200%/);
  });

  it('keeps minor and moderate axe findings as advisories, not failures', () => {
    expect(row('1.4.1').status).toBe('Not Evaluated');
    expect(row('1.4.1').remarks).toContain('link-in-text-block (1)');
  });

  it('counts every criterion once and renders a draft marked for sign-off', () => {
    const v = vpat();
    expect(Object.values(v.summary).reduce((a, b) => a + b, 0)).toBe(55);
    expect(v.status).toBe('draft, pending owner sign-off');
    const md = vpatMarkdown(v);
    expect(md).toContain('DRAFT — pending owner sign-off');
    expect(md).toContain('| 2.4.2 Page Titled (Level A) | Supports |');
    expect(md.split('\n').filter((l) => /^\| \d\.\d\.\d/.test(l))).toHaveLength(55);
  });

  it('a viewport signal counts only tests where axe ran at that width', () => {
    const v = buildVpat(
      criteria(),
      [
        {
          title: 'checkout times out',
          file: 'checkout.spec.ts',
          project: 'mobile-375',
          status: 'unexpected',
          axe: [],
        },
        {
          title: 'org home passes axe',
          file: 'a11y.spec.ts',
          project: 'mobile-375',
          status: 'expected',
          axe: [{ passes: [], violations: [], incomplete: [] }],
        },
      ],
      NOW,
    );
    const reflow = v.criteria.find((c) => c.id === '1.4.10');
    expect(reflow).toMatchObject({ status: 'Supports', tests: { passed: 1, failed: 0 } });
  });

  it('with no e2e reports every criterion is Not Evaluated or Not Applicable', () => {
    const v = buildVpat(criteria(), [], NOW);
    expect(v.summary.Supports).toBe(0);
    expect(v.summary['Partially Supports']).toBe(0);
    expect(v.summary['Not Evaluated'] + v.summary['Not Applicable']).toBe(55);
  });
});
