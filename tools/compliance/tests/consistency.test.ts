import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { SEEDED_ORG_SLUGS } from '../src/bundle.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const POLICIES = 'compliance/policies';

describe('policy drafts', () => {
  const files = readdirSync(join(ROOT, POLICIES)).filter((f) => f.endsWith('.md'));

  it('has the seven policies the brief asks for', () => {
    expect(files.sort()).toEqual([
      'access-control.md',
      'business-continuity.md',
      'change-management.md',
      'data-retention.md',
      'incident-response.md',
      'information-security.md',
      'vendor-management.md',
    ]);
  });

  it('marks each one "draft, pending owner" with an unsigned approval row', () => {
    for (const f of files) {
      const text = read(`${POLICIES}/${f}`);
      expect(text, f).toMatch(/\*\*Status: draft, pending owner\.\*\*/);
      expect(text, f).toMatch(/\| 0\.1 draft \| \d{4}-\d{2}-\d{2} \| pending owner \|/);
    }
  });

  it('links only to files that exist (runbooks, other policies)', () => {
    for (const f of files) {
      const text = read(`${POLICIES}/${f}`);
      const links = [...text.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1] ?? '');
      for (const l of links.filter((l) => !l.startsWith('http')))
        expect(existsSync(resolve(dirname(join(ROOT, POLICIES, f)), l)), `${f} → ${l}`).toBe(true);
    }
  });

  it('data retention states the D11 periods', () => {
    const text = read(`${POLICIES}/data-retention.md`);
    expect(text).toContain('D11');
    expect(text).toMatch(/Attendee personal data \| 24 months after the event/);
    expect(text).toMatch(/Audit log \| 12 months hot \+ 7 years WORM/);
  });
});

describe('seeded org allowlist', () => {
  it('matches the seed orgs and the worker sampler', () => {
    const personas = read('apps/web/src/server/personas.ts').split('SEED_ORGS')[1] ?? '';
    const seeded = [...personas.matchAll(/slug: '([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(seeded).toEqual([...SEEDED_ORG_SLUGS]);
    const worker = read('apps/worker/src/evidence.ts').match(/SEEDED_ORG_SLUGS = \[([^\]]+)\]/)?.[1] ?? '';
    expect([...worker.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])).toEqual([...SEEDED_ORG_SLUGS]);
  });
});

describe('evidence workflow', () => {
  const wf = parse(read('.github/workflows/evidence.yml')) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, { steps: { name?: string; run?: string; uses?: string }[] }>;
  };

  it('runs on a schedule and on demand with a read-only token', () => {
    expect(wf.on).toHaveProperty('schedule');
    expect(wf.on).toHaveProperty('workflow_dispatch');
    expect(Object.values(wf.permissions).every((p) => p === 'read')).toBe(true);
  });

  it('checks controls, builds, self-tests the leak gate, runs gitleaks, then uploads', () => {
    const steps = wf.jobs.bundle?.steps ?? [];
    const at = (re: RegExp) =>
      steps.findIndex((s) => re.test(`${s.name ?? ''} ${s.run ?? ''} ${s.uses ?? ''}`));
    const order = [
      at(/check-controls/),
      at(/cli\.ts ci /),
      at(/plant-canaries/),
      at(/gitleaks" dir "\$BUNDLE"/),
      at(/upload-artifact/),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(steps.filter((s) => /upload-artifact/.test(s.uses ?? ''))).toHaveLength(1);
  });
});
