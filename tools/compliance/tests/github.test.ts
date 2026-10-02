import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectAccess,
  collectBranchProtection,
  collectCiRuns,
  collectPullRequests,
  GithubClient,
  type GithubOptions,
  latestApprovals,
  OWNER_APPROVAL_LABELS,
} from '../src/github.ts';
import { scanText } from '../src/redact.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

type Route = { status?: number; body: unknown; link?: string };
function fakeFetch(routes: Record<string, Route>, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push(`${url} ${(init?.headers as Record<string, string>)?.authorization ?? ''}`);
    const path = url.replace('https://gh.test', '');
    const hit = Object.entries(routes).find(([p]) => path.startsWith(p));
    if (!hit) return new Response('{"message":"Not Found"}', { status: 404 });
    const [, r] = hit;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: r.link ? { link: r.link } : {},
    });
  }) as typeof fetch;
}

const options = (routes: Record<string, Route>, seen?: string[]): GithubOptions => ({
  api: 'https://gh.test',
  repo: 'acme/app',
  token: 'read-only-token',
  branch: 'main',
  since: new Date('2026-07-01T00:00:00Z'),
  fetch: fakeFetch(routes, seen),
});

describe('GitHub evidence exports', () => {
  it('owner-approval labels are exactly the PR template risk tags', () => {
    const template = readFileSync(join(ROOT, '.github/pull_request_template.md'), 'utf8');
    const section = template.split('## Risk tags')[1]?.split('\n## ')[0] ?? '';
    const tags = [...section.matchAll(/^- \[ \] ([a-z-]+)$/gm)].map((m) => m[1]);
    expect(tags).toEqual([...OWNER_APPROVAL_LABELS]);
  });

  it('follows pagination and sends the token', async () => {
    const seen: string[] = [];
    const o = options(
      {
        '/repos/acme/app/actions/runs?': {
          body: { workflow_runs: [{ id: 1, name: 'CI', conclusion: 'success' }] },
          link: '<https://gh.test/page2/runs>; rel="next", <https://gh.test/page2/runs>; rel="last"',
        },
        '/page2/runs': { body: { workflow_runs: [{ id: 2, name: 'CI', conclusion: 'failure' }] } },
        '/repos/acme/app/actions/runs/1/jobs': {
          body: { jobs: [{ name: 'gitleaks', conclusion: 'success', completed_at: '2026-09-01T00:00:00Z' }] },
        },
        '/repos/acme/app/actions/runs/2/jobs': { body: { jobs: [{ name: 'e2e', conclusion: 'failure' }] } },
      },
      seen,
    );
    const r = await collectCiRuns(new GithubClient(o), o);
    expect(r.summary).toEqual({ runs: 2, byConclusion: { success: 1, failure: 1 } });
    expect(r.runs[0]?.jobs).toEqual([
      { name: 'gitleaks', conclusion: 'success', completedAt: '2026-09-01T00:00:00Z' },
    ]);
    expect(seen[0]).toContain('created=%3E%3D2026-07-01');
    expect(seen.every((s) => s.endsWith('Bearer read-only-token'))).toBe(true);
  });

  it('records endpoints a read-only token cannot read as unavailable, and keeps going', async () => {
    const o = options({
      '/repos/acme/app/branches/main/protection': {
        status: 403,
        body: { message: 'Resource not accessible' },
      },
      '/repos/acme/app/rules/branches/main': {
        body: [{ type: 'pull_request', ruleset_id: 7, parameters: { required_approving_review_count: 1 } }],
      },
      '/repos/acme/app/collaborators': { status: 403, body: {} },
      '/repos/acme/app/teams': { status: 404, body: {} },
      '/repos/acme/app/environments': {
        body: { environments: [{ name: 'production', protection_rules: [{ type: 'required_reviewers' }] }] },
      },
      '/repos/acme/app': { body: { visibility: 'private', default_branch: 'main' } },
    });
    const gh = new GithubClient(o);
    const bp = await collectBranchProtection(gh, o);
    expect(bp.protection).toMatchObject({ available: false, status: 403 });
    expect(bp.protection).toHaveProperty('note', expect.stringContaining('evidence-production.md'));
    expect(bp.rules).toEqual({
      available: true,
      data: [{ type: 'pull_request', ruleset: 7, parameters: { required_approving_review_count: 1 } }],
    });
    const access = await collectAccess(gh, o);
    expect(access.repository).toMatchObject({ available: true, visibility: 'private' });
    expect(access.collaborators).toMatchObject({ available: false, status: 403 });
    expect(access.teams).toMatchObject({ available: false, status: 404 });
    expect(access.environments).toEqual({
      available: true,
      data: [{ name: 'production', protectionRules: ['required_reviewers'] }],
    });
  });

  it('exports readable branch protection settings', async () => {
    const o = options({
      '/repos/acme/app/branches/main/protection': {
        body: {
          required_status_checks: {
            strict: true,
            contexts: ['gitleaks', 'e2e + axe (375/768/1280, en + ar)'],
          },
          required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true },
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
        },
      },
    });
    const bp = await collectBranchProtection(new GithubClient(o), o);
    expect(bp.protection).toMatchObject({
      available: true,
      requiredChecks: ['gitleaks', 'e2e + axe (375/768/1280, en + ar)'],
      requiredApprovals: 1,
      dismissStaleReviews: true,
      enforceAdmins: true,
      allowForcePushes: false,
    });
  });

  it('change management: merged PRs in the window, risk labels, independent approvals, redacted titles', async () => {
    const o = options({
      '/repos/acme/app/pulls?': {
        body: [
          {
            number: 11,
            title: 'M5.11a evidence (thanks jane@corp.example.com)',
            user: { login: 'dev' },
            merged_at: '2026-09-20T00:00:00Z',
            merged_by: { login: 'owner' },
            labels: [{ name: 'infra' }, { name: 'docs' }],
          },
          { number: 10, title: 'closed, never merged', user: { login: 'dev' }, merged_at: null, labels: [] },
          {
            number: 9,
            title: 'Self-approved',
            user: { login: 'dev' },
            merged_at: '2026-09-10T00:00:00Z',
            labels: [{ name: 'payments' }],
          },
          {
            number: 3,
            title: 'Before the window',
            user: { login: 'dev' },
            merged_at: '2026-01-01T00:00:00Z',
            labels: [],
          },
        ],
      },
      '/repos/acme/app/pulls/11/reviews': {
        body: [
          { user: { login: 'owner' }, state: 'APPROVED', submitted_at: '2026-09-19T00:00:00Z' },
          { user: { login: 'bot' }, state: 'COMMENTED', submitted_at: '2026-09-19T01:00:00Z' },
        ],
      },
      '/repos/acme/app/pulls/9/reviews': {
        body: [{ user: { login: 'dev' }, state: 'APPROVED', submitted_at: '2026-09-09T00:00:00Z' }],
      },
    });
    const r = await collectPullRequests(new GithubClient(o), o);
    expect(r.pulls.map((p) => p.number)).toEqual([11, 9]);
    expect(r.pulls[0]).toMatchObject({
      title: 'M5.11a evidence (thanks [redacted:email])',
      riskLabels: ['infra'],
      requiresOwnerApproval: true,
      approvedBy: ['owner'],
      mergedBy: 'owner',
      finding: null,
    });
    expect(r.pulls[1]).toMatchObject({ approvedBy: [], finding: 'no_independent_approval' });
    expect(r.summary).toEqual({ merged: 2, riskTagged: 2, withoutIndependentApproval: 1 });
    expect(scanText(JSON.stringify(r))).toEqual([]);
  });

  it('an approval counts only while it is the reviewer’s latest verdict, and never the author’s own', () => {
    expect(
      latestApprovals(
        [
          { reviewer: 'a', state: 'APPROVED', submittedAt: '2026-09-01T00:00:00Z' },
          { reviewer: 'a', state: 'CHANGES_REQUESTED', submittedAt: '2026-09-02T00:00:00Z' },
          { reviewer: 'b', state: 'CHANGES_REQUESTED', submittedAt: '2026-09-01T00:00:00Z' },
          { reviewer: 'b', state: 'APPROVED', submittedAt: '2026-09-03T00:00:00Z' },
          { reviewer: 'b', state: 'COMMENTED', submittedAt: '2026-09-04T00:00:00Z' },
          { reviewer: 'author', state: 'APPROVED', submittedAt: '2026-09-05T00:00:00Z' },
        ],
        'author',
      ),
    ).toEqual(['b']);
  });

  it('fails loudly on server errors instead of writing partial evidence', async () => {
    const o = options({ '/repos/acme/app/actions/runs?': { status: 500, body: {} } });
    await expect(collectCiRuns(new GithubClient(o), o)).rejects.toThrow(/HTTP 500/);
  });
});
