import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  type ControlMap,
  checkControls,
  EXPORT_NAMES,
  parseControls,
  REQUIRED_CRITERIA,
} from '../src/controls.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const real = () => parseControls(readFileSync(join(ROOT, 'compliance/controls.yaml'), 'utf8'));

const withControls = (controls: ControlMap['controls']): ControlMap => ({ ...real(), controls });
const problemsOf = (map: ControlMap) =>
  checkControls(map, ROOT).problems.map((p) => `${p.control}: ${p.message}`);

describe('SOC 2 control mapping (compliance/controls.yaml)', () => {
  it('covers every in-scope criterion (CC1–CC9, A1, C1), each with evidence that resolves', () => {
    const report = checkControls(real(), ROOT);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.controls).toBe(REQUIRED_CRITERIA.length);
    for (const id of REQUIRED_CRITERIA) {
      const kinds = report.coverage[id] ?? {};
      expect(
        Object.values(kinds).reduce((a, b) => a + b, 0),
        id,
      ).toBeGreaterThan(0);
    }
  });

  it('scopes exactly the families the brief names', () => {
    expect(real().scope).toEqual(['CC1', 'CC2', 'CC3', 'CC4', 'CC5', 'CC6', 'CC7', 'CC8', 'CC9', 'A1', 'C1']);
    const families = new Set(REQUIRED_CRITERIA.map((id) => id.split('.')[0]));
    expect([...families]).toEqual(real().scope);
  });

  it('uses every export the bundle produces, and every policy draft', () => {
    const used = new Set(
      real().controls.flatMap((c) => c.evidence.flatMap((e) => (e.kind === 'export' ? [e.name] : []))),
    );
    for (const name of EXPORT_NAMES.filter((n) => n !== 'vpat')) expect(used.has(name), name).toBe(true);
    const policies = new Set(
      real().controls.flatMap((c) => c.evidence.flatMap((e) => (e.kind === 'policy' ? [e.path] : []))),
    );
    expect(policies.size).toBe(7);
  });

  it('flags a missing criterion', () => {
    const map = withControls(real().controls.filter((c) => c.id !== 'CC6.1'));
    expect(problemsOf(map)).toContain('CC6.1: criterion is missing from the mapping');
  });

  it('flags a criterion with no evidence', () => {
    const map = withControls(real().controls.map((c) => (c.id === 'CC8.1' ? { ...c, evidence: [] } : c)));
    expect(problemsOf(map)).toContain('CC8.1: has no evidence source');
  });

  it('flags paths that do not exist, escape the repo or sit in the wrong place', () => {
    const map = withControls(
      real().controls.map((c) =>
        c.id === 'CC7.4'
          ? {
              ...c,
              evidence: [
                { kind: 'runbook' as const, path: 'docs/runbooks/does-not-exist.md' },
                { kind: 'doc' as const, path: '../outside.md' },
                { kind: 'policy' as const, path: 'docs/runbooks/incident.md' },
                { kind: 'test' as const, path: 'packages/platform/src/audit.ts' },
              ],
            }
          : c,
      ),
    );
    expect(problemsOf(map)).toEqual([
      'CC7.4: docs/runbooks/does-not-exist.md does not exist',
      'CC7.4: path ../outside.md must be repo-relative',
      'CC7.4: policy path docs/runbooks/incident.md is not where a policy lives',
      'CC7.4: test path packages/platform/src/audit.ts is not where a test lives',
    ]);
  });

  it('flags CI jobs the workflow does not define, missing workflows and unknown exports', () => {
    const map = withControls(
      real().controls.map((c) =>
        c.id === 'CC4.1'
          ? {
              ...c,
              evidence: [
                { kind: 'ci_job' as const, workflow: '.github/workflows/ci.yml', job: 'no-such-job' },
                { kind: 'ci_job' as const, workflow: '.github/workflows/nope.yml', job: 'checks' },
                { kind: 'export' as const, name: 'github.everything' },
              ],
            }
          : c,
      ),
    );
    expect(problemsOf(map)).toEqual([
      'CC4.1: workflow .github/workflows/ci.yml has no job "no-such-job"',
      'CC4.1: workflow .github/workflows/nope.yml does not exist',
      'CC4.1: unknown export "github.everything"',
    ]);
  });

  it('flags duplicates and out-of-scope criteria', () => {
    const first = real().controls[0];
    if (!first) throw new Error('empty mapping');
    const map = withControls([...real().controls, first, { ...first, id: 'CC9.9' }]);
    expect(problemsOf(map)).toEqual([
      `${first.id}: listed more than once`,
      'CC9.9: not an in-scope criterion',
    ]);
  });

  it('rejects malformed files (unknown keys, bad ids)', () => {
    const doc = { ...real(), controls: [{ id: 'CC1', title: 't', description: 'd', evidence: [] }] };
    expect(() => parseControls(stringify(doc))).toThrow();
    const extra = { ...real(), surprise: true };
    expect(() => parseControls(stringify(extra))).toThrow();
  });
});
