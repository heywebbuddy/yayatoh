import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { executeQuery } from '@yayatoh/kernel';
import { auditLogQuery } from '@yayatoh/platform';
import { createOrgFixture, type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDED_ORG_SLUGS } from '../src/bundle.ts';
import { scanBundle } from '../src/redact.ts';

/**
 * M5.11a acceptance: the evidence bundle builds from a CI run with no manual step, and holds no
 * secrets or customer data. Runs the same `cli.ts ci` command the Evidence workflow runs, against
 * the integration database (seed orgs created here), a fake GitHub API and a fixture e2e report.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const CLI = join(ROOT, 'tools/compliance/cli.ts');
const tmp = mkdtempSync(join(tmpdir(), 'evidence-int-'));
// Token- and email-shaped values the fake GitHub returns; assembled so the repo never holds them.
const LEAKED_TOKEN = `${'gh'}p_${'Zq7'.repeat(12)}`;
const LEAKED_EMAIL = `jane.${Date.now()}@corp-example.com`;

let server: Server;
let api: string;
const seeded: OrgFixture[] = [];
let other: { a: OrgFixture; b: OrgFixture };
let bundle: string;

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number; out: string }>((done) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('close', (code) => done({ code: code ?? -1, out }));
  });
}

const ROUTES: Record<string, unknown> = {
  '/repos/acme/app/actions/runs': {
    workflow_runs: [
      {
        id: 501,
        name: 'CI',
        event: 'push',
        head_branch: 'main',
        conclusion: 'success',
        html_url: 'https://github.com/acme/app/actions/runs/501',
      },
    ],
  },
  '/repos/acme/app/actions/runs/501/jobs': {
    jobs: [
      { name: 'gitleaks', conclusion: 'success' },
      { name: 'integration + isolation (Postgres 18)', conclusion: 'success' },
    ],
  },
  '/repos/acme/app/rules/branches/main': [{ type: 'pull_request', ruleset_id: 1, parameters: {} }],
  '/repos/acme/app/pulls/7/reviews': [
    { user: { login: 'owner' }, state: 'APPROVED', submitted_at: '2026-09-28T00:00:00Z' },
  ],
  '/repos/acme/app/pulls': [
    {
      number: 7,
      title: `Fix ${LEAKED_TOKEN} reported by ${LEAKED_EMAIL}`,
      user: { login: 'dev' },
      merged_at: new Date().toISOString(),
      merged_by: { login: 'owner' },
      labels: [{ name: 'tenancy' }],
    },
  ],
  '/repos/acme/app/environments': { environments: [] },
  '/repos/acme/app': { visibility: 'private', default_branch: 'main' },
};

beforeAll(async () => {
  // The seed orgs `pnpm seed` creates in CI, here created by the fixture (full org data).
  const admin = adminClient();
  try {
    for (const [slug, name] of [
      ['lakeside-events', 'Lakeside Events'],
      ['rosewood-weddings', 'Rosewood Weddings'],
    ] as const) {
      const [row] = await admin`select 1 from tenancy.organizations where slug = ${slug}`;
      if (!row) seeded.push(await createOrgFixture(slug, name));
    }
  } finally {
    await admin.end();
  }
  other = await twoOrgs();

  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const auth = req.headers.authorization;
    if (auth !== 'Bearer ro-token') {
      res.writeHead(401).end('{}');
      return;
    }
    if (path in ROUTES) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(ROUTES[path]));
      return;
    }
    // Branch protection, collaborators, teams: what a read-only token can't read.
    res.writeHead(403, { 'content-type': 'application/json' }).end('{"message":"Resource not accessible"}');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  mkdirSync(join(tmp, 'e2e/e2e-report-1/web/e2e-results'), { recursive: true });
  cpSync(
    join(ROOT, 'tools/compliance/tests/fixtures/playwright-report.json'),
    join(tmp, 'e2e/e2e-report-1/web/e2e-results/results.json'),
  );
}, 180_000);

afterAll(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
  rmSync(tmp, { recursive: true, force: true });
  await closePools();
});

const files = (base: string, dir = base, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(base, p, out);
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
};

describe('evidence bundle from a CI run (M5.11a)', () => {
  it('builds with no manual step: exports, audit samples, VPAT, policies, checksums, leak gate', async () => {
    const r = await run(['ci', '--out', join(tmp, 'out'), '--e2e', join(tmp, 'e2e'), '--since-days', '30'], {
      GITHUB_API_URL: api,
      GITHUB_REPOSITORY: 'acme/app',
      GITHUB_TOKEN: 'ro-token',
      GITHUB_RUN_ID: '4242',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
    });
    expect(r.out).toContain('leak gate clean');
    expect(r.code).toBe(0);
    bundle = readFileSync(join(tmp, 'out/bundle-path'), 'utf8').trim();
    expect(bundle).toMatch(/evidence-\d{4}-\d{2}-\d{2}$/);

    const list = files(bundle).sort();
    for (const f of [
      'README.md',
      'SHA256SUMS',
      'manifest.json',
      'audit/audit-samples.json',
      'controls/check.json',
      'controls/controls.yaml',
      'github/access.json',
      'github/branch-protection.json',
      'github/ci-runs.json',
      'github/pull-requests.json',
      'policies/information-security.md',
      'vpat/vpat.json',
      'vpat/vpat.md',
    ])
      expect(list).toContain(f);
    expect(list.filter((f) => f.startsWith('policies/'))).toHaveLength(7);

    // Every checksum verifies, the manifest's included.
    for (const line of readFileSync(join(bundle, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
      const [sum, path] = line.split(/\s+/);
      const actual = createHash('sha256')
        .update(readFileSync(join(bundle, path ?? '')))
        .digest('hex');
      expect(actual, path).toBe(sum);
    }
    expect(readFileSync(join(bundle, 'SHA256SUMS'), 'utf8').trim().split('\n')).toHaveLength(list.length - 1);

    const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
    expect(manifest.meta).toMatchObject({
      runId: '4242',
      repository: 'acme/app',
      event: 'workflow_dispatch',
    });
    expect(manifest.controls).toEqual({ criteria: 38, evidence: expect.any(Number) });
    expect(JSON.parse(readFileSync(join(bundle, 'controls/check.json'), 'utf8')).ok).toBe(true);

    const ci = JSON.parse(readFileSync(join(bundle, 'github/ci-runs.json'), 'utf8'));
    expect(ci.runs[0].jobs.map((j: { name: string }) => j.name)).toContain('gitleaks');
    const prs = JSON.parse(readFileSync(join(bundle, 'github/pull-requests.json'), 'utf8'));
    expect(prs.pulls[0]).toMatchObject({ number: 7, riskLabels: ['tenancy'], approvedBy: ['owner'] });
    const bp = JSON.parse(readFileSync(join(bundle, 'github/branch-protection.json'), 'utf8'));
    expect(bp.protection).toMatchObject({ available: false, status: 403 });

    const vpat = JSON.parse(readFileSync(join(bundle, 'vpat/vpat.json'), 'utf8'));
    expect(vpat.status).toBe('draft, pending owner sign-off');
    expect(vpat.source.axeScans).toBe(6);
    expect(vpat.summary.Supports).toBeGreaterThan(0);
  });

  it('holds no secrets or customer data', async () => {
    expect(scanBundle(bundle)).toMatchObject({ ok: true, findings: [] });
    const text = files(bundle)
      .map((f) => readFileSync(join(bundle, f), 'utf8'))
      .join('\n');
    const dbPasswords = [
      process.env.DATABASE_URL,
      process.env.PLATFORM_READER_DATABASE_URL,
      process.env.MIGRATOR_DATABASE_URL,
    ]
      .filter((u): u is string => Boolean(u))
      .map((u) => decodeURIComponent(new URL(u).password))
      .filter((p) => p.length >= 8);
    const forbidden = [
      LEAKED_TOKEN,
      LEAKED_EMAIL,
      'ro-token',
      ...dbPasswords,
      ...[process.env.APP_TOKEN_SECRET, process.env.LOCAL_KMS_KEY, process.env.FAKE_PAYMENTS_SECRET].filter(
        (v): v is string => Boolean(v),
      ),
      // Customer data the fixture orgs hold (buyers, holders, waitlist, imports, API keys).
      'Fixture Buyer',
      'Fixture Waiter',
      'buyer@',
      'waiter@',
      'imported-',
      other.a.apiKey,
      ...seeded.map((s) => s.apiKey),
      // Non-seeded orgs never appear at all.
      other.a.org.slug,
      other.b.org.slug,
      other.a.org.id,
    ];
    for (const f of forbidden) expect(text.includes(f), `bundle contains ${f.slice(0, 12)}…`).toBe(false);
    expect(text).toContain('[redacted:github_token]');
    expect(text).toContain('[redacted:email]');
  });

  it('samples the audit log of seeded orgs only, through an audited platform read', async () => {
    const samples = JSON.parse(readFileSync(join(bundle, 'audit/audit-samples.json'), 'utf8'));
    expect(samples.source).toBe('seeded-ci-database');
    const slugs = samples.orgs.map((o: { slug: string }) => o.slug);
    expect(slugs).toEqual(expect.arrayContaining(['lakeside-events', 'rosewood-weddings']));
    for (const s of slugs) expect(SEEDED_ORG_SLUGS).toContain(s);
    for (const o of samples.orgs) {
      expect(o.chain.verified).toBe(true);
      expect(o.entries.length).toBeGreaterThan(0);
    }
    const foreign = await executeQuery(auditLogQuery, { limit: 100 }, other.a.ctx(), ports);
    const foreignTargets = new Set(
      foreign.entries.flatMap((e) =>
        e.targetId && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(e.targetId) ? [e.targetId] : [],
      ),
    );
    for (const o of samples.orgs)
      for (const e of o.entries) expect(foreignTargets.has(e.targetId)).toBe(false);

    const admin = adminClient();
    try {
      const rows = await admin`select actor, reason from platform.access_log where actor = 'system:evidence'`;
      expect(rows.map((r) => r.reason)).toContain('SOC 2 evidence bundle: audit-log sample of seeded orgs');
    } finally {
      await admin.end();
    }
  });

  it('planted secret canaries fail the leak gate', async () => {
    const dir = join(tmp, 'canary-secret');
    cpSync(bundle, dir, { recursive: true });
    expect((await run(['plant-canaries', '--dir', dir, '--class', 'secret'])).code).toBe(0);
    const r = await run(['scan', '--dir', dir]);
    expect(r.code).toBe(1);
    for (const kind of ['github_token', 'aws_key', 'stripe_key', 'private_key'])
      expect(r.out).toContain(`LEAK ${kind}`);
    expect(r.out).toContain('nothing may be uploaded');
  });

  it('planted customer-data canaries fail the leak gate', async () => {
    const dir = join(tmp, 'canary-customer');
    cpSync(bundle, dir, { recursive: true });
    expect((await run(['plant-canaries', '--dir', dir, '--class', 'customer'])).code).toBe(0);
    const r = await run(['scan', '--dir', dir]);
    expect(r.code).toBe(1);
    for (const kind of ['email', 'ipv4', 'card_number']) expect(r.out).toContain(`LEAK ${kind}`);
  });

  it('refuses audit samples from any org but the seeded ones, leaving no bundle behind', async () => {
    const out = join(tmp, 'foreign');
    mkdirSync(out, { recursive: true });
    const samples = JSON.parse(readFileSync(join(bundle, 'audit/audit-samples.json'), 'utf8'));
    samples.orgs.push({ ...samples.orgs[0], slug: other.a.org.slug });
    writeFileSync(join(out, 'samples.json'), JSON.stringify(samples));
    const r = await run(['bundle', '--out', out, '--audit', join(out, 'samples.json')]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('non-seeded orgs');
    expect(readdirSync(out)).toEqual(['samples.json']);

    const prod = { ...samples, source: 'production-owner-run', orgs: samples.orgs.slice(0, 1) };
    writeFileSync(join(out, 'samples.json'), JSON.stringify(prod));
    expect((await run(['bundle', '--out', out, '--audit', join(out, 'samples.json')])).code).not.toBe(0);
    expect(existsSync(join(out, 'bundle-path'))).toBe(false);
  });

  it('the control mapping gate passes on the repository', async () => {
    const r = await run(['check-controls']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/38 criteria, \d+ evidence sources, all resolve/);
  });
});
