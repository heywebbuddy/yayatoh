#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { closePools } from '@yayatoh/db';
import { fakePaymentProvider } from '@yayatoh/payments';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { demoHandles, resetDemoOwner } from './src/demo.ts';
import { legacyFreezeProbe } from './src/freeze-probe.ts';
import { orderLinkReport } from './src/order-links.ts';
import { reverseEtl, rollbackSql, summarizeReverse } from './src/reverse-etl.ts';
import { rollbackRefunds } from './src/rollback-refunds.ts';
import { revalidate, runMigration } from './src/run.ts';
import { generateDumpFile, SCALES } from './src/synth/generate.ts';
import { checkTarget, TargetRefused } from './src/target.ts';

/**
 * Legacy migration (roadmap §7.5; runbook docs/runbooks/legacy-migration.md). Runs as `migrator`.
 *
 *   pnpm migrate:legacy --instance=yay|abc --mode=rehearsal|cutover --dump <file.sql[.gz]>
 *        [--event-clock=platform|venue] [--system-timezone=America/New_York] [--report report.json]
 *        [--freeze-at=2026-11-03T07:00:00Z]   (cutover T−0; default: now)
 *   pnpm migrate:legacy:order-links --instance=yay|abc [--report plan.json]   (dry run, never sends)
 *   pnpm migrate:legacy:validate --instance=yay|abc [--report report.json]
 *   pnpm migrate:legacy:synth --instance=yay|abc --out <file.sql[.gz]> [--scale=small|demo|large] [--seed=N] [--demo]
 *   pnpm migrate:legacy:demo      (synthetic yay + abc → migrated; writes the e2e handles)
 *   pnpm migrate:legacy:reverse --instance=yay|abc --cutover-at=<ISO> [--apply --target=local|staging]
 *        [--report r.json] [--mysql rollback.sql]   (M2.5a; default: dry run, nothing written)
 *   pnpm migrate:legacy:rollback-refunds --instance=… --cutover-at=<ISO> [--order <id>[,<id>]]
 *        [--apply --target=local|staging]   (M2.5a; fake provider only; default: plan)
 *   pnpm migrate:legacy:freeze-probe --instance=… --freeze-at=<ISO>   (M2.5a; read-only)
 *
 * Exit codes: 0 pass, 1 validation or quarantine breach, 2 usage or runtime error.
 */
const [command, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
const args = new Map<string, string>();
for (let i = 0; i < rest.length; i++) {
  const a = rest[i] as string;
  if (!a.startsWith('--')) fail(`unexpected argument "${a}"`);
  const eq = a.indexOf('=');
  if (eq > 0) args.set(a.slice(2, eq), a.slice(eq + 1));
  else if (rest[i + 1] && !(rest[i + 1] as string).startsWith('--'))
    args.set(a.slice(2), rest[++i] as string);
  else args.set(a.slice(2), 'true');
}

function fail(message: string): never {
  console.error(`migrate:legacy: ${message}`);
  process.exit(2);
}

function instanceArg(): 'yay' | 'abc' {
  const i = args.get('instance');
  if (i !== 'yay' && i !== 'abc') fail('--instance=yay|abc is required');
  return i;
}

function instantArg(name: string): Date {
  const v = args.get(name);
  if (!v || Number.isNaN(Date.parse(v))) fail(`--${name}=<ISO instant> is required`);
  return new Date(v);
}

/** A write needs an allowlisted target (tools/legacy-migrate/src/target.ts). */
function guardTarget() {
  try {
    const d = checkTarget(args.get('target'), process.env);
    console.info(`target ${d.target}: database host(s) ${d.hosts.join(', ')}`);
  } catch (err) {
    if (err instanceof TargetRefused) fail(err.message);
    throw err;
  }
}

function keyVaultFromEnv() {
  // Envelope encryption for signing keys and manage-token links. Production uses the KMS adapter
  // (pending, docs/owner-inbox.md); dev, CI and rehearsals use the local vault.
  const key = process.env.LOCAL_KMS_KEY;
  if (!key) fail('LOCAL_KMS_KEY is not set (the key vault encrypts signing keys and manage tokens)');
  setKeyVault(localKeyVault(key));
}

function writeReport(report: unknown) {
  const out = args.get('report');
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
    console.info(`migrate:legacy report written to ${out}`);
  }
}

async function main(): Promise<number> {
  switch (command) {
    case 'run': {
      const instance = instanceArg();
      const mode = args.get('mode') ?? 'rehearsal';
      if (mode !== 'rehearsal' && mode !== 'cutover') fail('--mode=rehearsal|cutover');
      const clock = args.get('event-clock') ?? 'platform';
      if (clock !== 'platform' && clock !== 'venue') fail('--event-clock=platform|venue');
      if (!args.get('dump') && !args.has('skip-load'))
        fail('--dump <file> is required (or --skip-load to re-transform staging)');
      const freeze = args.get('freeze-at');
      if (freeze !== undefined && Number.isNaN(Date.parse(freeze))) fail('--freeze-at=<ISO instant>');
      keyVaultFromEnv();
      const r = await runMigration({
        instance,
        mode,
        dump: args.get('dump'),
        eventClock: clock,
        systemTimezone: args.get('system-timezone'),
        freezeAt: freeze ? new Date(freeze) : undefined,
      });
      writeReport(r.report);
      console.info(r.summary);
      return r.pass ? 0 : 1;
    }
    case 'validate': {
      const r = await revalidate(instanceArg());
      writeReport(r.report);
      console.info(r.summary);
      return r.pass ? 0 : 1;
    }
    case 'order-links': {
      const r = await orderLinkReport(instanceArg());
      writeReport(r);
      console.info(
        `migrate:legacy:order-links ${r.instance} (dry run): ${r.planned} order links planned for ${r.buyers} buyers (${r.tickets} tickets), ${r.skipped} skipped ${JSON.stringify(r.skipped)}`,
      );
      return 0;
    }
    case 'synth': {
      const instance = instanceArg();
      const out = args.get('out') ?? fail('--out <file.sql[.gz]> is required');
      const scale = args.get('scale') ?? 'small';
      if (!SCALES[scale]) fail(`--scale=${Object.keys(SCALES).join('|')}`);
      const s = await generateDumpFile(out, {
        instance,
        scale,
        seed: args.has('seed') ? Number(args.get('seed')) : undefined,
        demo: args.has('demo'),
      });
      console.info(`migrate:legacy:synth ${instance} → ${out}: ${JSON.stringify(s.rows)}`);
      return 0;
    }
    case 'demo': {
      keyVaultFromEnv();
      const dir = mkdtempSync(join(tmpdir(), 'legacy-demo-'));
      let ok = true;
      try {
        for (const instance of ['yay', 'abc'] as const) {
          const dump = join(dir, `${instance}.sql`);
          await generateDumpFile(dump, { instance, scale: 'demo', demo: instance === 'yay' });
          const r = await runMigration({
            instance,
            mode: 'rehearsal',
            dump,
            log: () => {},
            // The e2e browser reaches the marketplace as yayatoh.localhost: load yay's legacy
            // redirects for it too.
            extraHosts: instance === 'yay' ? ['yayatoh.localhost'] : [],
          });
          console.info(r.summary);
          // CI only sees stdout: print what failed, not just that it failed.
          if (!r.pass)
            for (const c of r.report.checks.filter((c) => !c.pass))
              console.info(`${c.id} details: ${JSON.stringify(c.details)}`);
          ok &&= r.pass;
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      await resetDemoOwner();
      const out = resolve(args.get('out') ?? 'apps/web/e2e/.generated/legacy-demo.json');
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(await demoHandles(), null, 2)}\n`);
      console.info(`migrate:legacy:demo handles written to ${out}`);
      return ok ? 0 : 1;
    }
    case 'reverse': {
      const instance = instanceArg();
      const cutoverAt = instantArg('cutover-at');
      const apply = args.has('apply');
      if (apply) guardTarget();
      const r = await reverseEtl({ instance, cutoverAt, dryRun: !apply });
      writeReport(r);
      console.info(summarizeReverse(r));
      const mysqlOut = args.get('mysql');
      if (mysqlOut) {
        if (!apply) fail('--mysql needs --apply (the script is built from the rows written)');
        mkdirSync(dirname(resolve(mysqlOut)), { recursive: true });
        writeFileSync(resolve(mysqlOut), await rollbackSql(instance));
        console.info(`reverse ETL MySQL script written to ${mysqlOut} (review it; nothing was run on MySQL)`);
      }
      return r.pass ? 0 : 1;
    }
    case 'rollback-refunds': {
      const instance = instanceArg();
      const cutoverAt = instantArg('cutover-at');
      const apply = args.has('apply');
      if (apply) guardTarget();
      const provider = args.get('provider') ?? 'fake';
      // Real Stripe refunds are a reviewed runbook step the owner runs (pending owner): never here.
      if (provider !== 'fake')
        fail('--provider=fake only (a Stripe refund is run by the owner, runbook "cutover")');
      const secret = process.env.FAKE_PAYMENTS_SECRET;
      if (!secret) fail('FAKE_PAYMENTS_SECRET is not set');
      const orders = args.get('order')?.split(',').filter(Boolean);
      const r = await rollbackRefunds({
        instance,
        cutoverAt,
        provider: fakePaymentProvider({ secret, appOrigin: 'http://localhost' }),
        ...(apply && orders?.length ? { orderIds: orders } : {}),
        actor: `cli:${process.env.USER ?? 'unknown'}`,
      });
      writeReport(r);
      console.info(
        `migrate:legacy:rollback-refunds ${instance}${r.dryRun ? ' (plan: nothing refunded)' : ''}: ${r.eligible} eligible; ${r.items
          .map((i) => `${i.orderId} ${i.status} ${i.amountMinor} ${i.currency}`)
          .join('; ')}`,
      );
      return r.items.some((i) => i.status === 'failed') ? 1 : 0;
    }
    case 'freeze-probe': {
      const r = await legacyFreezeProbe(instanceArg(), instantArg('freeze-at'));
      writeReport(r);
      console.info(
        `migrate:legacy:freeze-probe ${r.instance} at ${r.freezeAt}: ${r.pass ? 'PASS (no writes after the freeze)' : 'FAIL'} ${JSON.stringify(r.tables)}`,
      );
      return r.pass ? 0 : 1;
    }
    default:
      fail(
        'commands: run | validate | synth | demo | order-links | reverse | rollback-refunds | freeze-probe',
      );
  }
}

main()
  .then(async (code) => {
    await closePools();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    await closePools().catch(() => {});
    process.exit(2);
  });
