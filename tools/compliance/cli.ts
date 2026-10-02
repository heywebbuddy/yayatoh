#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from './src/bundle.ts';
import { allCanaries, customerCanaries, secretCanaries } from './src/canaries.ts';
import { checkControls, parseControls } from './src/controls.ts';
import {
  collectAccess,
  collectBranchProtection,
  collectCiRuns,
  collectPullRequests,
  GithubClient,
  type GithubOptions,
} from './src/github.ts';
import { scanBundle } from './src/redact.ts';
import { buildVpat, parseCriteria, testsFromReport, vpatMarkdown } from './src/vpat.ts';

/**
 * yayatoh compliance — SOC 2 evidence automation (M5.11a). Run from the repo root.
 *
 *   node tools/compliance/cli.ts check-controls
 *   node tools/compliance/cli.ts collect-github --out DIR [--repo owner/name] [--branch main] [--since-days 90]
 *   node tools/compliance/cli.ts vpat --e2e DIR --out DIR
 *   node tools/compliance/cli.ts bundle --out DIR --audit FILE [--github DIR] [--e2e DIR]
 *   node tools/compliance/cli.ts scan --dir DIR [--report FILE]
 *   node tools/compliance/cli.ts plant-canaries --dir DIR [--class secret|customer|all]
 *   node tools/compliance/cli.ts ci --out DIR [--e2e DIR] [--skip-github]
 *
 * `ci` is what the scheduled workflow runs: control check → GitHub exports → audit samples
 * from the seeded database → bundle → leak scan. Exit 1 on a failed gate, 2 on bad usage.
 * GitHub reads use GITHUB_TOKEN, GITHUB_API_URL and GITHUB_REPOSITORY (set by Actions).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [command, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
const args = new Map<string, string>();
const flags = new Set<string>();
for (let i = 0; i < rest.length; i++) {
  const k = rest[i] ?? '';
  if (!k.startsWith('--')) fail(`bad argument "${k}"`);
  const v = rest[i + 1];
  if (v === undefined || v.startsWith('--')) flags.add(k.slice(2));
  else {
    args.set(k.slice(2), v);
    i++;
  }
}

function fail(message: string, code = 2): never {
  console.error(`compliance: ${message}`);
  process.exit(code);
}
const need = (name: string) => args.get(name) ?? fail(`--${name} is required`);

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Every Playwright JSON report (`*.json` with `suites` and `config`) under a directory. */
function e2eReports(dir: string | undefined): unknown[] {
  if (!dir || !existsSync(dir)) return [];
  const out: unknown[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.json')) {
        try {
          const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
          if (Array.isArray(j.suites) && j.config) out.push(j);
        } catch {
          // not a report
        }
      }
    }
  };
  walk(dir);
  return out;
}

function checkControlsOrExit() {
  const report = checkControls(
    parseControls(readFileSync(join(ROOT, 'compliance/controls.yaml'), 'utf8')),
    ROOT,
  );
  for (const p of report.problems) console.error(`  ${p.control}: ${p.message}`);
  if (!report.ok) fail(`control mapping: ${report.problems.length} problem(s)`, 1);
  console.info(`compliance: ${report.controls} criteria, ${report.evidence} evidence sources, all resolve`);
}

function githubOptions(): GithubOptions {
  const repo =
    args.get('repo') ?? process.env.GITHUB_REPOSITORY ?? fail('--repo or GITHUB_REPOSITORY is required');
  const days = Number(args.get('since-days') ?? 90);
  if (!Number.isInteger(days) || days < 1 || days > 400) fail('--since-days must be 1–400');
  return {
    api: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    repo,
    token: process.env.GITHUB_TOKEN,
    branch: args.get('branch') ?? 'main',
    since: new Date(Date.now() - days * 86_400_000),
  };
}

async function collectGithub(out: string) {
  const o = githubOptions();
  const gh = new GithubClient(o);
  const data = {
    ciRuns: await collectCiRuns(gh, o),
    branchProtection: await collectBranchProtection(gh, o),
    pullRequests: await collectPullRequests(gh, o),
    access: await collectAccess(gh, o),
  };
  writeJson(join(out, 'ci-runs.json'), data.ciRuns);
  writeJson(join(out, 'branch-protection.json'), data.branchProtection);
  writeJson(join(out, 'pull-requests.json'), data.pullRequests);
  writeJson(join(out, 'access.json'), data.access);
  console.info(`compliance: GitHub exports for ${o.repo}@${o.branch} → ${out}`);
  return data;
}

function readGithub(dir: string) {
  const r = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
  return {
    ciRuns: r('ci-runs.json'),
    branchProtection: r('branch-protection.json'),
    pullRequests: r('pull-requests.json'),
    access: r('access.json'),
  };
}

function meta(): Record<string, string | null> {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return {
    gitSha: git.status === 0 ? git.stdout.trim() : null,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null,
  };
}

function scanOrExit(dir: string, reportPath?: string) {
  const report = scanBundle(dir);
  if (reportPath) writeJson(reportPath, report);
  for (const f of report.findings) console.error(`  LEAK ${f.kind} ${f.file}:${f.line} ${f.preview}`);
  if (!report.ok)
    fail(`leak gate: ${report.findings.length} finding(s) in ${dir}; nothing may be uploaded`, 1);
  console.info(`compliance: leak gate clean (${report.files} files)`);
}

switch (command) {
  case 'check-controls': {
    checkControlsOrExit();
    break;
  }
  case 'collect-github': {
    await collectGithub(need('out'));
    break;
  }
  case 'vpat': {
    const out = need('out');
    const criteria = parseCriteria(readFileSync(join(ROOT, 'compliance/vpat/wcag22.yaml'), 'utf8'));
    const v = buildVpat(criteria, e2eReports(need('e2e')).flatMap(testsFromReport));
    writeJson(join(out, 'vpat.json'), v);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'vpat.md'), vpatMarkdown(v));
    console.info(`compliance: VPAT draft from ${v.source.tests} test runs → ${out}`);
    break;
  }
  case 'bundle': {
    const r = buildBundle({
      root: ROOT,
      outDir: need('out'),
      now: new Date(),
      github: args.has('github') ? readGithub(need('github')) : undefined,
      auditSamples: JSON.parse(readFileSync(need('audit'), 'utf8')),
      e2eReports: e2eReports(args.get('e2e')),
      meta: meta(),
    });
    console.info(`compliance: bundle ${r.dir} (${r.files} files, manifest sha256 ${r.manifestSha256})`);
    break;
  }
  case 'scan': {
    scanOrExit(need('dir'), args.get('report'));
    break;
  }
  case 'plant-canaries': {
    const dir = need('dir');
    const cls = args.get('class') ?? 'all';
    const list =
      cls === 'secret' ? secretCanaries() : cls === 'customer' ? customerCanaries() : allCanaries();
    for (const c of list) {
      mkdirSync(dirname(join(dir, c.file)), { recursive: true });
      writeFileSync(join(dir, c.file), c.content);
    }
    console.info(`compliance: planted ${list.length} ${cls} canaries in ${dir}`);
    break;
  }
  case 'ci': {
    const out = resolve(need('out'));
    const work = join(out, '.work');
    mkdirSync(work, { recursive: true });
    checkControlsOrExit();
    const github = flags.has('skip-github') ? undefined : await collectGithub(join(work, 'github'));
    const auditFile = join(work, 'audit-samples.json');
    const sample = spawnSync('node', ['apps/worker/scripts/audit-sample.ts', '--out', auditFile], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    if (sample.status !== 0) fail('audit samples failed', 1);
    const r = buildBundle({
      root: ROOT,
      outDir: out,
      now: new Date(),
      github,
      auditSamples: JSON.parse(readFileSync(auditFile, 'utf8')),
      e2eReports: e2eReports(args.get('e2e')),
      meta: meta(),
    });
    console.info(`compliance: bundle ${r.dir} (${r.files} files, manifest sha256 ${r.manifestSha256})`);
    scanOrExit(r.dir, join(work, 'leak-scan.json'));
    // The workflow reads this to name the artifact and run gitleaks on the same directory.
    writeFileSync(join(out, 'bundle-path'), `${r.dir}\n`);
    break;
  }
  default:
    fail(
      'usage: cli.ts <check-controls|collect-github|vpat|bundle|scan|plant-canaries|ci> [options] (see the header)',
    );
}
