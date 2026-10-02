import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * The SOC 2 control mapping (`compliance/controls.yaml`, M5.11a): every in-scope Trust Services
 * Criterion must name at least one evidence source, and every source must resolve.
 */

/** The in-scope criteria (AICPA TSC 2017, revised points of focus 2022): CC1–CC9, A1, C1. */
export const REQUIRED_CRITERIA = [
  'CC1.1',
  'CC1.2',
  'CC1.3',
  'CC1.4',
  'CC1.5',
  'CC2.1',
  'CC2.2',
  'CC2.3',
  'CC3.1',
  'CC3.2',
  'CC3.3',
  'CC3.4',
  'CC4.1',
  'CC4.2',
  'CC5.1',
  'CC5.2',
  'CC5.3',
  'CC6.1',
  'CC6.2',
  'CC6.3',
  'CC6.4',
  'CC6.5',
  'CC6.6',
  'CC6.7',
  'CC6.8',
  'CC7.1',
  'CC7.2',
  'CC7.3',
  'CC7.4',
  'CC7.5',
  'CC8.1',
  'CC9.1',
  'CC9.2',
  'A1.1',
  'A1.2',
  'A1.3',
  'C1.1',
  'C1.2',
] as const;

/** What the scheduled evidence bundle collects (`bundle.ts` writes each one). */
export const EXPORT_NAMES = [
  'github.ci_runs',
  'github.branch_protection',
  'github.pull_requests',
  'github.access',
  'audit.samples',
  'vpat',
] as const;

const PATH_KINDS = ['policy', 'adr', 'runbook', 'doc', 'test', 'code'] as const;
/** Where each path kind must live, so a policy can't point at a random file. */
const PATH_PREFIX: Record<(typeof PATH_KINDS)[number], RegExp> = {
  policy: /^compliance\/policies\/[a-z0-9-]+\.md$/,
  adr: /^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/,
  runbook: /^docs\/runbooks\/[A-Za-z0-9-]+\.md$/,
  doc: /^[^/].*$/,
  test: /\.test\.tsx?$|\.spec\.ts$/,
  code: /^(apps|packages|tools)\//,
};

const Note = z.string().max(300).optional();
const Evidence = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(PATH_KINDS), path: z.string().min(1), note: Note }).strict(),
  z
    .object({ kind: z.literal('ci_job'), workflow: z.string().min(1), job: z.string().min(1), note: Note })
    .strict(),
  z.object({ kind: z.literal('export'), name: z.string().min(1), note: Note }).strict(),
]);
export type Evidence = z.infer<typeof Evidence>;

const Control = z
  .object({
    id: z.string().regex(/^(CC\d|A1|C1)\.\d$/),
    title: z.string().min(1),
    description: z.string().min(1),
    evidence: z.array(Evidence).default([]),
    owner: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type Control = z.infer<typeof Control>;

export const ControlMap = z
  .object({
    version: z.literal(1),
    framework: z.string().min(1),
    scope: z.array(z.string()),
    status: z.string().min(1),
    controls: z.array(Control),
  })
  .strict();
export type ControlMap = z.infer<typeof ControlMap>;

export interface ControlProblem {
  readonly control: string;
  readonly message: string;
}

export interface ControlReport {
  readonly ok: boolean;
  readonly controls: number;
  readonly evidence: number;
  readonly problems: readonly ControlProblem[];
  /** Per criterion: how many sources of each kind (the bundle's coverage table). */
  readonly coverage: Record<string, Record<string, number>>;
}

export function parseControls(text: string): ControlMap {
  return ControlMap.parse(parse(text));
}

/** The job ids a workflow file defines (top-level keys under `jobs:`). */
export function workflowJobs(root: string, workflow: string): Set<string> | null {
  const file = join(root, workflow);
  if (!existsSync(file)) return null;
  const doc = parse(readFileSync(file, 'utf8')) as { jobs?: Record<string, unknown> } | null;
  return new Set(Object.keys(doc?.jobs ?? {}));
}

/** Completeness and resolution: the gate `check-controls` runs in CI and in the bundle. */
export function checkControls(map: ControlMap, root: string): ControlReport {
  const problems: ControlProblem[] = [];
  const coverage: Record<string, Record<string, number>> = {};
  const seen = new Set<string>();
  const jobsCache = new Map<string, Set<string> | null>();
  let evidence = 0;

  for (const c of map.controls) {
    if (seen.has(c.id)) problems.push({ control: c.id, message: 'listed more than once' });
    seen.add(c.id);
    if (!(REQUIRED_CRITERIA as readonly string[]).includes(c.id))
      problems.push({ control: c.id, message: 'not an in-scope criterion' });
    if (c.evidence.length === 0) problems.push({ control: c.id, message: 'has no evidence source' });
    const kinds: Record<string, number> = {};
    for (const e of c.evidence) {
      evidence += 1;
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      if (e.kind === 'ci_job') {
        if (!jobsCache.has(e.workflow)) jobsCache.set(e.workflow, workflowJobs(root, e.workflow));
        const jobs = jobsCache.get(e.workflow);
        if (!jobs) problems.push({ control: c.id, message: `workflow ${e.workflow} does not exist` });
        else if (!jobs.has(e.job))
          problems.push({ control: c.id, message: `workflow ${e.workflow} has no job "${e.job}"` });
      } else if (e.kind === 'export') {
        if (!(EXPORT_NAMES as readonly string[]).includes(e.name))
          problems.push({ control: c.id, message: `unknown export "${e.name}"` });
      } else {
        if (e.path.includes('..') || e.path.startsWith('/'))
          problems.push({ control: c.id, message: `path ${e.path} must be repo-relative` });
        else if (!PATH_PREFIX[e.kind].test(e.path))
          problems.push({
            control: c.id,
            message: `${e.kind} path ${e.path} is not where a ${e.kind} lives`,
          });
        else if (!existsSync(join(root, e.path)))
          problems.push({ control: c.id, message: `${e.path} does not exist` });
      }
    }
    coverage[c.id] = kinds;
  }
  for (const id of REQUIRED_CRITERIA)
    if (!seen.has(id)) problems.push({ control: id, message: 'criterion is missing from the mapping' });

  return { ok: problems.length === 0, controls: map.controls.length, evidence, problems, coverage };
}
