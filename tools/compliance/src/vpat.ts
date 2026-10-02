import { parse } from 'yaml';
import { z } from 'zod';
import { redactValue } from './redact.ts';

/**
 * The VPAT (WCAG 2.2 AA) draft (M5.11a, P5-6): generated from the e2e shards' Playwright JSON
 * reports, never from new tests. axe results arrive as each test's `axe-summary` attachment
 * (`expectAccessible` in apps/web/e2e/helpers.ts); keyboard, Arabic RTL and other suites are
 * recognised by their titles. The output is a draft for the owner's sign-off.
 */

const Coverage = z.enum(['automated', 'partial', 'manual', 'not_applicable']);
const Criterion = z
  .object({
    id: z.coerce.string().regex(/^\d\.\d\.\d{1,2}$/),
    name: z.string().min(1),
    level: z.enum(['A', 'AA']),
    coverage: Coverage,
    signals: z.array(z.string()).default([]),
    remark: z.string().optional(),
    manual: z.string().optional(),
  })
  .strict();
export type Criterion = z.infer<typeof Criterion>;

export const CriteriaFile = z
  .object({
    version: z.literal(1),
    standard: z.string(),
    signals: z.record(z.string(), z.string()),
    criteria: z.array(Criterion).min(1),
  })
  .strict()
  .superRefine((f, ctx) => {
    for (const c of f.criteria)
      for (const s of c.signals)
        if (!(s in f.signals)) ctx.addIssue({ code: 'custom', message: `${c.id}: unknown signal ${s}` });
  });
export type CriteriaFile = z.infer<typeof CriteriaFile>;

export const parseCriteria = (text: string): CriteriaFile => CriteriaFile.parse(parse(text));

/** What `expectAccessible` attaches: rule ids, tags and counts only (no selectors, no URLs). */
export const AxeSummary = z.object({
  passes: z.array(z.object({ id: z.string(), tags: z.array(z.string()), nodes: z.int() })),
  violations: z.array(
    z.object({ id: z.string(), tags: z.array(z.string()), impact: z.string().nullable(), nodes: z.int() }),
  ),
  incomplete: z
    .array(
      z.object({ id: z.string(), tags: z.array(z.string()), impact: z.string().nullable(), nodes: z.int() }),
    )
    .default([]),
});
export type AxeSummary = z.infer<typeof AxeSummary>;

/** One test as the VPAT sees it. */
export interface E2eTest {
  readonly title: string;
  readonly file: string;
  readonly project: string;
  /** Playwright's verdict: expected, unexpected, flaky or skipped. */
  readonly status: string;
  readonly axe: readonly AxeSummary[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function decodeAttachment(a: Json): AxeSummary | null {
  if (a.name !== 'axe-summary' || typeof a.body !== 'string') return null;
  try {
    const parsed = AxeSummary.safeParse(JSON.parse(Buffer.from(a.body, 'base64').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Flatten a Playwright JSON report (`reporter: json`) into tests. */
export function testsFromReport(report: unknown): E2eTest[] {
  const out: E2eTest[] = [];
  const walk = (suite: Json, path: string[]) => {
    const title = typeof suite.title === 'string' && !suite.title.endsWith('.ts') ? [suite.title] : [];
    for (const spec of arr(suite.specs).map(obj)) {
      for (const t of arr(spec.tests).map(obj)) {
        out.push({
          title: [...path, ...title, String(spec.title ?? '')].filter(Boolean).join(' › '),
          file: String(spec.file ?? suite.file ?? ''),
          project: String(t.projectName ?? ''),
          status: String(t.status ?? 'unknown'),
          axe: arr(t.results)
            .map(obj)
            .slice(-1)
            .flatMap((r) => arr(r.attachments).map(obj))
            .map(decodeAttachment)
            .filter((x): x is AxeSummary => x !== null),
        });
      }
    }
    for (const s of arr(suite.suites).map(obj)) walk(s, [...path, ...title]);
  };
  for (const s of arr(obj(report).suites).map(obj)) walk(s, []);
  return out;
}

/** axe's tag for a criterion: `wcag` + the id without dots (1.4.3 → wcag143). */
export const axeTag = (id: string) => `wcag${id.replaceAll('.', '')}`;

export type Conformance =
  | 'Supports'
  | 'Partially Supports'
  | 'Does Not Support'
  | 'Not Applicable'
  | 'Not Evaluated';

export interface CriterionResult {
  readonly id: string;
  readonly name: string;
  readonly level: 'A' | 'AA';
  readonly status: Conformance;
  readonly confidence: z.infer<typeof Coverage>;
  readonly axeRules: readonly { id: string; passes: number; failures: number; advisories: number }[];
  readonly tests: { readonly passed: number; readonly failed: number; readonly examples: readonly string[] };
  readonly remarks: string;
}

export interface Vpat {
  readonly title: string;
  readonly status: 'draft, pending owner sign-off';
  readonly standard: string;
  readonly generatedAt: string;
  readonly source: {
    readonly tests: number;
    readonly testsWithAxe: number;
    readonly axeScans: number;
    readonly projects: readonly string[];
    readonly failedTests: number;
  };
  readonly summary: Record<Conformance, number>;
  readonly criteria: readonly CriterionResult[];
}

const FAIL_IMPACTS = new Set(['serious', 'critical']);

function matchesSignal(t: E2eTest, pattern: string): boolean {
  // A viewport signal is evidence only where axe judged the page at that width; a functional
  // test that happens to run in that project says nothing about reflow or orientation.
  if (pattern.startsWith('@project:'))
    return t.project === pattern.slice('@project:'.length) && t.axe.length > 0;
  return new RegExp(pattern, 'i').test(t.title);
}

export function buildVpat(criteria: CriteriaFile, tests: readonly E2eTest[], now = new Date()): Vpat {
  // Aggregate axe by rule across every scan.
  const rules = new Map<
    string,
    { tags: Set<string>; passes: number; failures: number; advisories: number }
  >();
  const rule = (id: string, tags: string[]) => {
    const r = rules.get(id) ?? { tags: new Set<string>(), passes: 0, failures: 0, advisories: 0 };
    for (const t of tags) r.tags.add(t);
    rules.set(id, r);
    return r;
  };
  let scans = 0;
  for (const t of tests) {
    for (const s of t.axe) {
      scans += 1;
      for (const p of s.passes) rule(p.id, p.tags).passes += 1;
      for (const v of s.violations) {
        const r = rule(v.id, v.tags);
        if (FAIL_IMPACTS.has(v.impact ?? '')) r.failures += 1;
        else r.advisories += 1;
      }
    }
  }
  const ran = tests.filter((t) => t.status !== 'skipped');

  const results: CriterionResult[] = criteria.criteria.map((c) => {
    const tag = axeTag(c.id);
    const axeRules = [...rules]
      .filter(([, r]) => r.tags.has(tag))
      .map(([id, r]) => ({ id, passes: r.passes, failures: r.failures, advisories: r.advisories }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const matched = ran.filter((t) => c.signals.some((s) => matchesSignal(t, criteria.signals[s] ?? '$^')));
    const failedTests = matched.filter((t) => t.status === 'unexpected');
    const passedTests = matched.filter((t) => t.status === 'expected' || t.status === 'flaky');
    const axePasses = axeRules.reduce((n, r) => n + r.passes, 0);
    const axeFailures = axeRules.filter((r) => r.failures > 0);
    const examples = [...new Set(passedTests.map((t) => `${t.file}: ${t.title}`))].slice(0, 5);
    const notes: string[] = [];
    let status: Conformance;

    if (c.coverage === 'not_applicable') {
      status = 'Not Applicable';
      notes.push(c.remark ?? 'Not applicable.', 'Owner to confirm.');
    } else if (axeFailures.length > 0 || failedTests.length > 0) {
      status = 'Partially Supports';
      if (axeFailures.length)
        notes.push(
          `axe serious/critical violations: ${axeFailures.map((r) => `${r.id} (${r.failures})`).join(', ')}.`,
        );
      if (failedTests.length)
        notes.push(
          `Failing e2e tests: ${[...new Set(failedTests.map((t) => t.title))].slice(0, 5).join('; ')}.`,
        );
    } else if (c.coverage !== 'manual' && (axePasses > 0 || passedTests.length > 0)) {
      status = 'Supports';
      const parts: string[] = [];
      if (axePasses > 0)
        parts.push(`axe rules ${axeRules.map((r) => r.id).join(', ')} passed in ${axePasses} scan(s)`);
      if (passedTests.length > 0)
        parts.push(`${passedTests.length} e2e test run(s) (${c.signals.join(', ')}) passed`);
      notes.push(`${parts.join('; ')}.`);
      if (c.coverage === 'partial')
        notes.push('Automated evidence only: confirm by manual review before sign-off.');
      if (c.manual) notes.push(c.manual);
    } else {
      status = 'Not Evaluated';
      notes.push(
        c.manual ? `Manual review needed: ${c.manual}` : 'Manual review needed: no automated evidence.',
      );
    }
    const advisories = axeRules.filter((r) => r.advisories > 0);
    if (advisories.length)
      notes.push(
        `Minor/moderate axe findings to review: ${advisories.map((r) => `${r.id} (${r.advisories})`).join(', ')}.`,
      );

    return {
      id: c.id,
      name: c.name,
      level: c.level,
      status,
      confidence: c.coverage,
      axeRules,
      tests: { passed: passedTests.length, failed: failedTests.length, examples },
      remarks: notes.join(' '),
    };
  });

  const summary: Record<Conformance, number> = {
    Supports: 0,
    'Partially Supports': 0,
    'Does Not Support': 0,
    'Not Applicable': 0,
    'Not Evaluated': 0,
  };
  for (const r of results) summary[r.status] += 1;

  return redactValue({
    title: 'Yayatoh 2.0 — Accessibility Conformance Report (VPAT® 2.5 WCAG edition)',
    status: 'draft, pending owner sign-off' as const,
    standard: criteria.standard,
    generatedAt: now.toISOString(),
    source: {
      tests: tests.length,
      testsWithAxe: tests.filter((t) => t.axe.length > 0).length,
      axeScans: scans,
      projects: [...new Set(tests.map((t) => t.project))].sort(),
      failedTests: tests.filter((t) => t.status === 'unexpected').length,
    },
    summary,
    criteria: results,
  });
}

const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');

export function vpatMarkdown(v: Vpat): string {
  const lines = [
    `# ${v.title}`,
    '',
    '> **DRAFT — pending owner sign-off (P5-6).** Generated from automated evidence; not a',
    '> conformance claim until the owner (or an accessibility reviewer the owner appoints) has',
    '> completed the manual reviews listed below and signed.',
    '',
    `- Standard: ${v.standard}`,
    `- Generated: ${v.generatedAt}`,
    `- Evaluation methods: axe-core (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) in ${v.source.axeScans} scan(s) across ${v.source.testsWithAxe} e2e test run(s); keyboard-only, Arabic RTL and other e2e suites (${v.source.tests} test runs, projects ${v.source.projects.join(', ') || 'none'}); manual review pending.`,
    `- Failing e2e test runs in the source reports: ${v.source.failedTests}`,
    '',
    '## Summary',
    '',
    '| Conformance | Criteria |',
    '|---|---|',
    ...Object.entries(v.summary).map(([k, n]) => `| ${k} | ${n} |`),
    '',
    '## Table 1: Success Criteria, Level A and AA',
    '',
    '| Criteria | Conformance Level | Remarks and Explanations | Evidence |',
    '|---|---|---|---|',
    ...v.criteria.map(
      (c) =>
        `| ${c.id} ${cell(c.name)} (Level ${c.level}) | ${c.status} | ${cell(c.remarks)} | ${cell(
          [
            c.axeRules.length ? `axe: ${c.axeRules.map((r) => r.id).join(', ')}` : '',
            c.tests.examples.length ? `e2e: ${c.tests.examples.join('; ')}` : '',
          ]
            .filter(Boolean)
            .join(' — ') || '—',
        )} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
