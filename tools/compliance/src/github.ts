import { redactValue } from './redact.ts';

/**
 * GitHub evidence exports (M5.11a): CI runs and gate results, branch protection, PR reviews and
 * approvals, repository access. Read-only REST calls with the workflow's `GITHUB_TOKEN`; an
 * endpoint that needs more than read access (branch protection, collaborators) is recorded as
 * `available: false` with its status, and the production evidence runbook says how the owner
 * exports it. Every string passes through `redactValue` before it is written.
 */

/** The PR template's risk tags: a PR carrying one needs the owner's approval (CLAUDE.md). */
export const OWNER_APPROVAL_LABELS = [
  'db-migration',
  'auth',
  'payments',
  'tenancy',
  'infra',
  'mobile-contract',
  'legal-copy',
] as const;

export interface GithubOptions {
  readonly api: string;
  readonly repo: string;
  readonly token?: string;
  readonly branch: string;
  /** Only runs and PRs from this instant on (the audit window). */
  readonly since: Date;
  /** Runs whose jobs (gate results) are fetched; older runs keep their conclusion only. */
  readonly jobsForRuns?: number;
  readonly maxPages?: number;
  readonly fetch?: typeof fetch;
}

export interface Fetched<T> {
  readonly available: boolean;
  readonly status: number;
  readonly data?: T;
  readonly note?: string;
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const login = (v: unknown) => str(obj(v).login);

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m?.[1]) return m[1];
  }
  return null;
}

export class GithubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly o: GithubOptions;
  constructor(o: GithubOptions) {
    this.o = o;
    this.fetchImpl = o.fetch ?? fetch;
  }

  private url(path: string) {
    return path.startsWith('http') ? path : `${this.o.api.replace(/\/$/, '')}${path}`;
  }

  private async request(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'yayatoh-evidence',
    };
    if (this.o.token) headers.authorization = `Bearer ${this.o.token}`;
    return this.fetchImpl(url, { headers });
  }

  /** One resource; 403/404 become `available: false` (the token can't read it). */
  async get<T = unknown>(path: string): Promise<Fetched<T>> {
    const res = await this.request(this.url(path));
    if (res.status === 403 || res.status === 404 || res.status === 401) {
      return { available: false, status: res.status, note: 'not readable with a read-only token' };
    }
    if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
    return { available: true, status: res.status, data: (await res.json()) as T };
  }

  /** Every page (up to `maxPages`); `key` picks the list out of a wrapped response. */
  async list(path: string, key?: string): Promise<Fetched<unknown[]>> {
    let url: string | null = this.url(path);
    const out: unknown[] = [];
    let pages = 0;
    while (url && pages < (this.o.maxPages ?? 10)) {
      const res = await this.request(url);
      if (res.status === 403 || res.status === 404 || res.status === 401) {
        return { available: false, status: res.status, note: 'not readable with a read-only token' };
      }
      if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      out.push(...arr(key ? obj(body)[key] : body));
      url = nextLink(res.headers.get('link'));
      pages += 1;
    }
    return { available: true, status: 200, data: out };
  }
}

export interface CiRun {
  readonly id: number | null;
  readonly workflow: string | null;
  readonly event: string | null;
  readonly branch: string | null;
  readonly headSha: string | null;
  readonly status: string | null;
  readonly conclusion: string | null;
  readonly attempt: number | null;
  readonly createdAt: string | null;
  readonly url: string | null;
  /** The gate results: each job's name and conclusion. */
  readonly jobs?: readonly { name: string | null; conclusion: string | null; completedAt: string | null }[];
}

export async function collectCiRuns(gh: GithubClient, o: GithubOptions) {
  const since = o.since.toISOString().slice(0, 10);
  const listed = await gh.list(
    `/repos/${o.repo}/actions/runs?branch=${encodeURIComponent(o.branch)}&per_page=100&created=%3E%3D${since}`,
    'workflow_runs',
  );
  const runs: CiRun[] = [];
  for (const [i, r] of (listed.data ?? []).entries()) {
    const x = obj(r);
    const run: CiRun = {
      id: num(x.id),
      workflow: str(x.name),
      event: str(x.event),
      branch: str(x.head_branch),
      headSha: str(x.head_sha),
      status: str(x.status),
      conclusion: str(x.conclusion),
      attempt: num(x.run_attempt),
      createdAt: str(x.created_at),
      url: str(x.html_url),
    };
    if (i < (o.jobsForRuns ?? 20) && run.id !== null) {
      const jobs = await gh.list(`/repos/${o.repo}/actions/runs/${run.id}/jobs?per_page=100`, 'jobs');
      runs.push({
        ...run,
        jobs: (jobs.data ?? []).map((j) => ({
          name: str(obj(j).name),
          conclusion: str(obj(j).conclusion),
          completedAt: str(obj(j).completed_at),
        })),
      });
    } else runs.push(run);
  }
  const byConclusion: Record<string, number> = {};
  for (const r of runs)
    byConclusion[r.conclusion ?? 'pending'] = (byConclusion[r.conclusion ?? 'pending'] ?? 0) + 1;
  return redactValue({
    repo: o.repo,
    branch: o.branch,
    since: o.since.toISOString(),
    available: listed.available,
    status: listed.status,
    summary: { runs: runs.length, byConclusion },
    runs,
  });
}

export async function collectBranchProtection(gh: GithubClient, o: GithubOptions) {
  const b = encodeURIComponent(o.branch);
  const protection = await gh.get<Json>(`/repos/${o.repo}/branches/${b}/protection`);
  const p = obj(protection.data);
  const reviews = obj(p.required_pull_request_reviews);
  const checks = obj(p.required_status_checks);
  const enabled = (v: unknown) => (typeof obj(v).enabled === 'boolean' ? (obj(v).enabled as boolean) : null);
  // Branch rules (rulesets) are readable with read access even when classic protection isn't.
  const rules = await gh.list(`/repos/${o.repo}/rules/branches/${b}?per_page=100`);
  return redactValue({
    branch: o.branch,
    protection: protection.available
      ? {
          available: true,
          requiredChecks: arr(checks.contexts).filter((c) => typeof c === 'string'),
          strictChecks: checks.strict ?? null,
          requiredApprovals: num(reviews.required_approving_review_count),
          dismissStaleReviews: reviews.dismiss_stale_reviews ?? null,
          requireCodeOwnerReviews: reviews.require_code_owner_reviews ?? null,
          requireLastPushApproval: reviews.require_last_push_approval ?? null,
          enforceAdmins: enabled(p.enforce_admins),
          linearHistory: enabled(p.required_linear_history),
          allowForcePushes: enabled(p.allow_force_pushes),
          allowDeletions: enabled(p.allow_deletions),
          conversationResolution: enabled(p.required_conversation_resolution),
          signedCommits: enabled(p.required_signatures),
        }
      : {
          available: false,
          status: protection.status,
          note: `${protection.note}; see docs/runbooks/evidence-production.md`,
        },
    rules: rules.available
      ? {
          available: true,
          data: (rules.data ?? []).map((r) => ({
            type: str(obj(r).type),
            ruleset: num(obj(r).ruleset_id),
            parameters: obj(r).parameters ?? null,
          })),
        }
      : { available: false, status: rules.status },
  });
}

export interface PullEvidence {
  readonly number: number | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly mergedAt: string | null;
  readonly mergedBy: string | null;
  readonly labels: readonly string[];
  readonly riskLabels: readonly string[];
  readonly requiresOwnerApproval: boolean;
  readonly reviews: readonly { reviewer: string | null; state: string | null; submittedAt: string | null }[];
  /** Reviewers whose latest review is APPROVED (a later "changes requested" cancels it). */
  readonly approvedBy: readonly string[];
  /** Change-management finding: merged without an approval from someone other than the author. */
  readonly finding: 'no_independent_approval' | null;
}

export function latestApprovals(
  reviews: readonly { reviewer: string | null; state: string | null; submittedAt: string | null }[],
  author: string | null,
): string[] {
  const latest = new Map<string, string>();
  const sorted = [...reviews].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  for (const r of sorted) {
    if (!r.reviewer || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(r.reviewer, r.state ?? '');
  }
  return [...latest]
    .filter(([who, state]) => state === 'APPROVED' && who !== author)
    .map(([who]) => who)
    .sort();
}

export async function collectPullRequests(gh: GithubClient, o: GithubOptions) {
  const listed = await gh.list(
    `/repos/${o.repo}/pulls?state=closed&base=${encodeURIComponent(o.branch)}&sort=updated&direction=desc&per_page=100`,
  );
  const pulls: PullEvidence[] = [];
  for (const p of listed.data ?? []) {
    const x = obj(p);
    const mergedAt = str(x.merged_at);
    if (!mergedAt || new Date(mergedAt) < o.since) continue;
    const n = num(x.number);
    const author = login(x.user);
    const labels = arr(x.labels)
      .map((l) => str(obj(l).name))
      .filter((l): l is string => l !== null);
    const riskLabels = labels.filter((l) => (OWNER_APPROVAL_LABELS as readonly string[]).includes(l));
    const reviewList =
      n === null ? { data: [] } : await gh.list(`/repos/${o.repo}/pulls/${n}/reviews?per_page=100`);
    const reviews = (reviewList.data ?? []).map((r) => ({
      reviewer: login(obj(r).user),
      state: str(obj(r).state),
      submittedAt: str(obj(r).submitted_at),
    }));
    const approvedBy = latestApprovals(reviews, author);
    pulls.push({
      number: n,
      title: str(x.title),
      author,
      mergedAt,
      mergedBy: login(x.merged_by),
      labels,
      riskLabels,
      requiresOwnerApproval: riskLabels.length > 0,
      reviews,
      approvedBy,
      finding: approvedBy.length === 0 ? 'no_independent_approval' : null,
    });
  }
  return redactValue({
    branch: o.branch,
    since: o.since.toISOString(),
    ownerApprovalLabels: OWNER_APPROVAL_LABELS,
    available: listed.available,
    summary: {
      merged: pulls.length,
      riskTagged: pulls.filter((p) => p.requiresOwnerApproval).length,
      withoutIndependentApproval: pulls.filter((p) => p.finding).length,
    },
    pulls,
  });
}

export async function collectAccess(gh: GithubClient, o: GithubOptions) {
  const [repo, collaborators, teams, environments] = await Promise.all([
    gh.get<Json>(`/repos/${o.repo}`),
    gh.list(`/repos/${o.repo}/collaborators?affiliation=all&per_page=100`),
    gh.list(`/repos/${o.repo}/teams?per_page=100`),
    gh.get<Json>(`/repos/${o.repo}/environments?per_page=100`),
  ]);
  const r = obj(repo.data);
  const note = 'needs admin access; the owner exports it (docs/runbooks/evidence-production.md)';
  return redactValue({
    repository: repo.available
      ? {
          available: true,
          visibility: str(r.visibility),
          defaultBranch: str(r.default_branch),
          allowForking: r.allow_forking ?? null,
          deleteBranchOnMerge: r.delete_branch_on_merge ?? null,
        }
      : { available: false, status: repo.status },
    collaborators: collaborators.available
      ? {
          available: true,
          data: (collaborators.data ?? []).map((c) => ({
            login: login(c),
            roleName: str(obj(c).role_name),
            admin: obj(obj(c).permissions).admin ?? null,
            push: obj(obj(c).permissions).push ?? null,
          })),
        }
      : { available: false, status: collaborators.status, note },
    teams: teams.available
      ? {
          available: true,
          data: (teams.data ?? []).map((t) => ({
            slug: str(obj(t).slug),
            permission: str(obj(t).permission),
          })),
        }
      : { available: false, status: teams.status, note },
    environments: environments.available
      ? {
          available: true,
          data: arr(obj(environments.data).environments).map((e) => ({
            name: str(obj(e).name),
            protectionRules: arr(obj(e).protection_rules).map((p) => str(obj(p).type)),
          })),
        }
      : { available: false, status: environments.status, note },
  });
}
