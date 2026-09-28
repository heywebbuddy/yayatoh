#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { demoHandles } from './src/demo.ts';
import { orderLinkReport } from './src/order-links.ts';
import { revalidate, runMigration } from './src/run.ts';
import { generateDumpFile, SCALES } from './src/synth/generate.ts';

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
          ok &&= r.pass;
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const out = resolve(args.get('out') ?? 'apps/web/e2e/.generated/legacy-demo.json');
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(await demoHandles(), null, 2)}\n`);
      console.info(`migrate:legacy:demo handles written to ${out}`);
      return ok ? 0 : 1;
    }
    default:
      fail('commands: run | validate | synth | demo | order-links');
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
