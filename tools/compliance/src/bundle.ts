import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { checkControls, parseControls } from './controls.ts';
import { redactValue } from './redact.ts';
import { buildVpat, type E2eTest, parseCriteria, testsFromReport, vpatMarkdown } from './vpat.ts';

/**
 * The dated, checksummed evidence bundle (M5.11a). Built by the scheduled evidence workflow
 * from a CI run with no manual step; scanned by the leak gate before upload. Everything in it
 * is text: JSON, YAML and Markdown.
 */

/**
 * The only orgs whose audit entries may enter a bundle: the seed orgs `pnpm seed` creates in
 * the throwaway CI database (apps/web/src/server/personas.ts SEED_ORGS). Never production.
 */
export const SEEDED_ORG_SLUGS = ['lakeside-events', 'rosewood-weddings', 'harbor-arts'] as const;

const Detail = z.union([z.string(), z.number(), z.boolean()]);
export const AuditSamples = z
  .object({
    source: z.literal('seeded-ci-database'),
    generatedAt: z.string(),
    perOrg: z.int().positive(),
    orgs: z.array(
      z
        .object({
          slug: z.string(),
          chain: z.object({
            verified: z.boolean(),
            entries: z.int(),
            brokenAt: z.int().nullable(),
            head: z.string().nullable(),
          }),
          entries: z.array(
            z
              .object({
                seq: z.int(),
                at: z.string(),
                actor: z.string(),
                action: z.string(),
                targetType: z.string(),
                targetId: z.string().nullable(),
                details: z.record(z.string(), Detail),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type AuditSamples = z.infer<typeof AuditSamples>;

export interface BundleInput {
  /** Repository root (controls, policies and criteria are read from here). */
  readonly root: string;
  /** Parent directory; the bundle is `<outDir>/evidence-<date>`. */
  readonly outDir: string;
  readonly now: Date;
  readonly github?: {
    readonly ciRuns: unknown;
    readonly branchProtection: unknown;
    readonly pullRequests: unknown;
    readonly access: unknown;
  };
  readonly auditSamples: unknown;
  /** Parsed Playwright JSON reports (one per e2e shard); may be empty. */
  readonly e2eReports: readonly unknown[];
  readonly allowedOrgs?: readonly string[];
  readonly meta?: Readonly<Record<string, string | null>>;
}

export interface BundleResult {
  readonly dir: string;
  readonly files: number;
  /** sha256 of manifest.json: the one value to record when the bundle is uploaded to Vanta. */
  readonly manifestSha256: string;
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

function listFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

/** Validate the audit samples: seeded orgs only, allowlisted entry shape, then redact. */
export function checkAuditSamples(raw: unknown, allowed: readonly string[] = SEEDED_ORG_SLUGS): AuditSamples {
  const s = AuditSamples.parse(raw);
  const foreign = s.orgs.filter((o) => !allowed.includes(o.slug)).map((o) => o.slug);
  if (foreign.length) throw new Error(`audit samples include non-seeded orgs: ${foreign.join(', ')}`);
  return redactValue(s);
}

export function buildBundle(input: BundleInput): BundleResult {
  const date = input.now.toISOString().slice(0, 10);
  const dir = join(input.outDir, `evidence-${date}`);
  if (existsSync(dir)) throw new Error(`${dir} exists; refusing to overwrite a bundle`);
  // Checked before anything is written: a bad sample leaves no partial bundle behind.
  const audit = checkAuditSamples(input.auditSamples, input.allowedOrgs);
  const write = (rel: string, body: string) => {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  // 1. Control mapping: must be complete and resolve, or there is no bundle.
  const controlsText = readFileSync(join(input.root, 'compliance/controls.yaml'), 'utf8');
  const report = checkControls(parseControls(controlsText), input.root);
  if (!report.ok)
    throw new Error(
      `control mapping check failed:\n${report.problems.map((p) => `  ${p.control}: ${p.message}`).join('\n')}`,
    );
  write('controls/controls.yaml', controlsText);
  write('controls/check.json', json(report));

  // 2. Policy drafts, as the owner will review them.
  const policies = join(input.root, 'compliance/policies');
  for (const f of readdirSync(policies)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    mkdirSync(join(dir, 'policies'), { recursive: true });
    copyFileSync(join(policies, f), join(dir, 'policies', f));
  }

  // 3. GitHub exports (already redacted by the collectors; redacted again, cheaply).
  if (input.github) {
    write('github/ci-runs.json', json(redactValue(input.github.ciRuns)));
    write('github/branch-protection.json', json(redactValue(input.github.branchProtection)));
    write('github/pull-requests.json', json(redactValue(input.github.pullRequests)));
    write('github/access.json', json(redactValue(input.github.access)));
  }

  // 4. Audit-log samples from the seeded CI database only.
  write('audit/audit-samples.json', json(audit));

  // 5. VPAT draft from the e2e shards' reports.
  const criteria = parseCriteria(readFileSync(join(input.root, 'compliance/vpat/wcag22.yaml'), 'utf8'));
  const tests: E2eTest[] = input.e2eReports.flatMap(testsFromReport);
  const vpat = buildVpat(criteria, tests, input.now);
  write('vpat/vpat.json', json(vpat));
  write('vpat/vpat.md', vpatMarkdown(vpat));

  // 6. What's inside and how to verify it.
  write(
    'README.md',
    [
      `# Yayatoh evidence bundle — ${date}`,
      '',
      'Built by `.github/workflows/evidence.yml` (M5.11a) from the CI database seeded for this run;',
      'no production data. Status: **draft evidence, pending owner review** (P5-6).',
      '',
      '| Path | What |',
      '|---|---|',
      '| controls/ | SOC 2 control mapping (CC1–CC9, A1, C1) and its completeness check |',
      '| policies/ | Policy drafts, pending owner |',
      '| github/ | CI runs and gate results, branch protection, merged PRs with reviews, access |',
      '| audit/ | Audit-log samples (allowlisted fields) and hash-chain checks, seeded orgs only |',
      '| vpat/ | VPAT (WCAG 2.2 AA) draft from the e2e axe and keyboard suites |',
      '| manifest.json, SHA256SUMS | Checksums of every file; verify with `sha256sum -c SHA256SUMS` |',
      '',
      'Production-only evidence (real access reviews, Doppler and hosting access lists) is added by',
      'the owner per docs/runbooks/evidence-production.md.',
      '',
    ].join('\n'),
  );

  // 7. Checksums over everything written so far.
  const entries = listFiles(dir).map((p) => {
    const buf = readFileSync(p);
    return { path: relative(dir, p).split(sep).join('/'), sha256: sha256(buf), bytes: buf.length };
  });
  const manifest = json(
    redactValue({
      bundle: `evidence-${date}`,
      generatedAt: input.now.toISOString(),
      meta: input.meta ?? {},
      controls: { criteria: report.controls, evidence: report.evidence },
      vpat: vpat.summary,
      files: entries,
    }),
  );
  write('manifest.json', manifest);
  write(
    'SHA256SUMS',
    `${entries.map((e) => `${e.sha256}  ${e.path}`).join('\n')}\n${sha256(manifest)}  manifest.json\n`,
  );
  return { dir, files: entries.length + 2, manifestSha256: sha256(manifest) };
}
