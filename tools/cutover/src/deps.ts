import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  eventsNearWindow,
  generateDumpFile,
  instanceOrgIds,
  latestRun,
  legacyFreezeProbe,
  migrationStatus,
  opsFlags,
  revalidate,
  reverseEtl,
  rollbackRefunds,
  rollbackSql,
  runMigration,
  setOpsFlag,
  smokeTargets,
  summarizeReverse,
} from '@yayatoh/legacy-migrate';
import { CUTOVER_AUDIENCES, CUTOVER_MOMENTS, renderCutoverSet } from '@yayatoh/notifications';
import { fakePaymentProvider } from '@yayatoh/payments';
import { simulatePostCutover } from './simulate.ts';
import type { CutoverDeps, Instance } from './types.ts';

export interface RealDepsOptions {
  /** Rehearsals: the synthetic scale the dump is generated at. */
  readonly scale: 'small' | 'demo' | 'large';
  readonly log: (message: string) => void;
}

/**
 * The real outside world for the orchestrator: the database through @yayatoh/legacy-migrate (as
 * migrator), the fake payment provider (never Stripe), HTTP smoke checks with fetch. Only called
 * for a real run, after the target guard allowed it; the dry run never builds these.
 */
export function realDeps(opts: RealDepsOptions): CutoverDeps {
  const secret = process.env.FAKE_PAYMENTS_SECRET ?? randomBytes(24).toString('hex');
  const fake = fakePaymentProvider({ secret, appOrigin: 'http://localhost' });
  return {
    now: () => new Date(),
    migrationStatus,
    latestRun,
    eventsNearWindow: (at, hours, scope) => eventsNearWindow(at, hours, scope),
    hostRoutes: async () => {
      const flags = await opsFlags();
      return Object.fromEntries(
        Object.entries(flags)
          .filter(([k]) => k.startsWith('host_route:'))
          .map(([k, v]) => [k, String((v as { target?: string }).target ?? '')]),
      );
    },
    commsReady: async () => {
      const missing: string[] = [];
      let rendered = 0;
      try {
        rendered = renderCutoverSet({
          start: new Date(),
          end: new Date(Date.now() + 45 * 60_000),
          timeZone: 'America/New_York',
          statusUrl: 'https://status.yayatoh.com/',
        }).length;
      } catch (err) {
        missing.push(String(err));
      }
      return {
        kinds: CUTOVER_MOMENTS.length * CUTOVER_AUDIENCES.length,
        locales: rendered / (CUTOVER_MOMENTS.length * CUTOVER_AUDIENCES.length),
        missing,
      };
    },
    prepareDump: async (instance: Instance, facts) => {
      const dir = join(tmpdir(), `cutover-${instance}-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      const dump = join(dir, `${instance}.sql.gz`);
      await generateDumpFile(dump, { instance, scale: opts.scale, demo: instance === 'yay' });
      facts.dumpGenerated = true;
      return dump;
    },
    runElt: async ({ instance, mode, dump, freezeAt }) => {
      const r = await runMigration({
        instance,
        mode,
        ...(dump ? { dump } : {}),
        freezeAt,
        log: (m) => opts.log(`  elt ${m}`),
      });
      return { pass: r.pass, summary: r.summary, runId: r.runId, totalMs: r.report.totalMs };
    },
    revalidate: async (instance) => {
      const r = await revalidate(instance);
      return { pass: r.pass, summary: r.summary };
    },
    freezeProbe: legacyFreezeProbe,
    instanceOrgIds,
    setFreeze: async (value, expectedEndAt, reason, actor) => {
      await setOpsFlag(
        'read_only_freeze',
        value ? { ...value, expectedEndAt: expectedEndAt?.toISOString() ?? null } : null,
        reason,
        actor,
      );
    },
    setHostRoute: async (host, target, reason, actor) => {
      await setOpsFlag(`host_route:${host}`, target ? { target } : null, reason, actor);
    },
    smoke: async (baseUrl, instance) => {
      const checks: { name: string; ok: boolean; detail: string }[] = [];
      const t = await smokeTargets(instance);
      checks.push({
        name: 'migrated public event exists',
        ok: t.eventSlug !== null,
        detail: t.eventSlug ?? 'none',
      });
      if (!baseUrl) return { checks };
      const get = async (name: string, path: string, want: (s: number) => boolean) => {
        try {
          const res = await fetch(new URL(path, baseUrl), { redirect: 'manual' });
          checks.push({ name, ok: want(res.status), detail: `${path} → ${res.status}` });
        } catch (err) {
          checks.push({ name, ok: false, detail: `${path}: ${String(err)}` });
        }
      };
      await get('home', '/', (s) => s === 200);
      await get('event listing', '/events', (s) => s === 200);
      await get('sign-in page', '/sign-in', (s) => s === 200);
      if (t.eventSlug)
        await get('migrated event over /api/v1', `/api/v1/public/events/${t.eventSlug}`, (s) => s === 200);
      return { checks };
    },
    reverseEtl: async (instance, cutoverAt) => {
      const r = await reverseEtl({ instance, cutoverAt, log: (m) => opts.log(`  reverse ${m}`) });
      return { pass: r.pass, summary: summarizeReverse(r), report: r };
    },
    rollbackSql,
    rollbackRefunds: async (instance, cutoverAt, orderIds) =>
      rollbackRefunds({
        instance,
        cutoverAt,
        provider: fake,
        ...(orderIds?.length ? { orderIds } : {}),
        actor: 'cutover',
      }),
    simulatePostCutover: (instance) => simulatePostCutover(instance, fake, secret),
    writeFile: async (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
  };
}
