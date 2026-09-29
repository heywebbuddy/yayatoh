import {
  type CutoverContext,
  FREEZE_ABORT_MS,
  FREEZE_TARGET_MS,
  type Step,
  type StepResult,
} from './types.ts';

/**
 * Roadmap §7.8 (per instance) as ordered, idempotent steps. `manual` steps are the owner's (the
 * checklist is printed, the operator types the step id once done; a rehearsal simulates them);
 * `decision` steps are the go/no-go points; `auto` steps run here. Every step can run again after a
 * failure: flags are set to a value, the ELT and the reverse ETL are idempotent.
 */
const ok = (summary: string, extra: Partial<StepResult> = {}): StepResult => ({
  ok: true,
  summary,
  ...extra,
});
const fail = (summary: string, extra: Partial<StepResult> = {}): StepResult => ({
  ok: false,
  summary,
  ...extra,
});
const actor = (ctx: CutoverContext) => `cutover:${ctx.options.operator}`;
const reason = (ctx: CutoverContext, what: string) =>
  `${ctx.mode === 'rehearsal' ? `rehearsal ${ctx.state.label}` : 'cutover'} ${ctx.instance}: ${what}`;

function freezeAt(ctx: CutoverContext): Date {
  if (!ctx.state.freezeAt) throw new Error('the legacy freeze has not started (step freeze_legacy)');
  return new Date(ctx.state.freezeAt);
}

/** Elapsed freeze time, for the go/no-go criteria. */
function elapsed(ctx: CutoverContext): number {
  return ctx.deps.now().getTime() - freezeAt(ctx).getTime();
}

/** A manual step: print the checklist; the confirmation is the operator's typed "done". */
function manual(
  id: string,
  title: string,
  when: string,
  budgetMin: number,
  checklist: readonly string[],
  onDone?: (ctx: CutoverContext) => void,
): Step {
  return {
    id,
    title,
    kind: 'manual',
    when,
    budgetMs: budgetMin * 60_000,
    plan: () => checklist.map((c) => `[ ] ${c}`),
    run: async (ctx) => {
      onDone?.(ctx);
      return ok(
        ctx.mode === 'rehearsal'
          ? `simulated (${checklist.length} items)`
          : `confirmed by ${ctx.options.operator}`,
        {
          details: { checklist },
        },
      );
    },
  };
}

/** The go/no-go points: every criterion true, and the freeze still inside the abort threshold. */
function decision(id: string, title: string, when: string, needs: readonly string[]): Step {
  return {
    id,
    title,
    kind: 'decision',
    when,
    budgetMs: 60_000,
    plan: () => [
      ...needs.map((n) => `requires step ${n} done`),
      `freeze elapsed below the abort threshold (${FREEZE_ABORT_MS / 60_000} min)`,
      'the operator types "go"',
    ],
    run: async (ctx) => {
      const missing = needs.filter((n) => ctx.state.tracks.forward[n]?.status !== 'done');
      const ms = elapsed(ctx);
      if (missing.length) return fail(`no-go: not done: ${missing.join(', ')}`);
      if (ms >= FREEZE_ABORT_MS) return fail(`no-go: freeze at ${Math.round(ms / 60_000)} min (abort at 90)`);
      const warnings =
        ms >= FREEZE_TARGET_MS ? [`freeze past the 45 min target (${Math.round(ms / 60_000)} min)`] : [];
      return ok(`go at ${Math.round(ms / 1000)} s into the freeze`, {
        warnings,
        details: { freezeElapsedMs: ms },
      });
    },
  };
}

export const FORWARD_STEPS: readonly Step[] = [
  {
    id: 'preflight',
    title: 'Pre-flight: migrations, last rehearsal green, host plan, freeze rules, comms',
    kind: 'auto',
    when: 'T−0, before the freeze',
    plan: (ctx) => [
      'every schema migration in the repository has run on the target database',
      `the latest ELT run for ${ctx.instance} passed V1–V12 (cutover mode: required)`,
      `host plan: ${ctx.options.hosts.join(', ')} are routed to legacy (or not yet routed)`,
      'no event with sales or check-ins within ±72 h (hard rule; cutover mode: required)',
      'the cutover message templates render in all 13 locales',
    ],
    run: async (ctx) => {
      const { deps, instance, mode } = ctx;
      const problems: string[] = [];
      const warnings: string[] = [];
      const m = await deps.migrationStatus();
      if (m.pending > 0) problems.push(`${m.pending} schema migration(s) not applied`);
      const last = await deps.latestRun(instance);
      if (!last?.pass)
        (mode === 'cutover' ? problems : warnings).push(`no green ELT run for ${instance} yet`);
      const routes = await deps.hostRoutes();
      const flipped = ctx.options.hosts.filter((h) => routes[`host_route:${h}`] === 'next');
      if (flipped.length) problems.push(`already routed to the new platform: ${flipped.join(', ')}`);
      const near = await deps.eventsNearWindow(deps.now(), 72, { instance, allOrgs: instance === 'yay' });
      if (near.length)
        (mode === 'cutover' ? problems : warnings).push(
          `${near.length} event(s) with sales or check-ins within ±72 h`,
        );
      const comms = await deps.commsReady();
      if (comms.missing.length) problems.push(`message templates missing: ${comms.missing.join(', ')}`);
      const details = { migrations: m, lastRun: last, routes, eventsNear: near.length, comms };
      return problems.length
        ? fail(problems.join('; '), { details, warnings })
        : ok(`${m.applied} migrations, comms ${comms.kinds}×${comms.locales}`, { details, warnings });
    },
  },
  manual('comms_freeze_start', 'Freeze-start messages and status page', 'T−0', 2, [
    'status page: maintenance posted',
    'owner sends the freezeStart messages to organizers and buyers (pnpm cutover comms; 13 locales; nothing is sent automatically)',
  ]),
  manual(
    'freeze_legacy',
    'Freeze the legacy app (read-only) and record T−0',
    'T−0',
    3,
    [
      'Laravel checkout paused since T−2 h; open Checkout Sessions expired; queues drained',
      'Laravel maintenance read-only: GETs served; writes and /api/v2 writes answer 503 + Retry-After',
      'scheduler and queue workers stopped',
      'no writes confirmed: MySQL binlog position recorded in the report',
    ],
    (ctx) => {
      ctx.state.freezeAt ??= ctx.deps.now().toISOString();
    },
  ),
  {
    id: 'freeze_new_app',
    title: 'Read-only freeze of the new app',
    kind: 'auto',
    when: 'T−0',
    plan: (ctx) => [
      ctx.instance === 'yay'
        ? 'platform-wide read-only freeze (B-Y: the whole front door moves; beta tenants were told at T−2)'
        : "read-only freeze of the organizations imported for abc (B-A: only abc's orgs)",
      'expected end: T−0 + 45 min (banner and Retry-After)',
    ],
    run: async (ctx) => {
      const end = new Date(freezeAt(ctx).getTime() + FREEZE_TARGET_MS);
      if (ctx.instance === 'yay') {
        await ctx.deps.setFreeze({ scope: 'platform' }, end, reason(ctx, 'freeze'), actor(ctx));
        ctx.state.newAppFreeze = { scope: 'platform', orgIds: [] };
        return ok('platform-wide');
      }
      const orgIds = await ctx.deps.instanceOrgIds(ctx.instance);
      ctx.state.newAppFreeze = { scope: 'orgs', orgIds };
      if (orgIds.length)
        await ctx.deps.setFreeze({ scope: 'orgs', orgIds }, end, reason(ctx, 'freeze'), actor(ctx));
      return ok(orgIds.length ? `${orgIds.length} org(s)` : 'no imported org yet (extended after the ELT)');
    },
  },
  {
    id: 'final_dump',
    title: 'Final dump of the frozen legacy database',
    kind: 'manual',
    when: 'T−0',
    budgetMs: 5 * 60_000,
    plan: (ctx) => [
      ctx.mode === 'rehearsal'
        ? 'rehearsal: generate the synthetic legacy dump (stands in for the frozen snapshot)'
        : 'mysqldump from the replica at the recorded binlog position (docs/runbooks/legacy-export.md)',
      `dump path: ${ctx.options.dump ?? '(the rehearsal generates one)'}`,
    ],
    run: async (ctx) => {
      const dump = ctx.options.dump ?? (await ctx.deps.prepareDump(ctx.instance, ctx.state.facts));
      if (!dump) return fail('no dump: pass --dump <file>');
      ctx.state.facts.dump = dump;
      return ok(dump);
    },
  },
  {
    id: 'delta_elt',
    title: 'Final ELT (load, T1–T9) on the frozen snapshot',
    kind: 'auto',
    when: 'T−0 (freeze window)',
    plan: (ctx) => [
      `pnpm migrate:legacy --instance=${ctx.instance} --mode=${ctx.mode} --freeze-at=<T−0> (idempotent: a rerun changes nothing)`,
    ],
    run: async (ctx) => {
      const r = await ctx.deps.runElt({
        instance: ctx.instance,
        mode: ctx.mode,
        dump: (ctx.state.facts.dump as string | undefined) ?? null,
        freezeAt: freezeAt(ctx),
      });
      // B-A: the orgs this import created are frozen too until go-live.
      if (ctx.instance === 'abc' && ctx.state.newAppFreeze?.scope === 'orgs') {
        const orgIds = await ctx.deps.instanceOrgIds(ctx.instance);
        if (orgIds.length) {
          const end = new Date(freezeAt(ctx).getTime() + FREEZE_TARGET_MS);
          await ctx.deps.setFreeze(
            { scope: 'orgs', orgIds },
            end,
            reason(ctx, 'freeze imported orgs'),
            actor(ctx),
          );
          ctx.state.newAppFreeze = { scope: 'orgs', orgIds };
        }
      }
      return r.pass
        ? ok(`run ${r.runId} in ${Math.round(r.totalMs / 1000)} s`, {
            details: { runId: r.runId, totalMs: r.totalMs },
          })
        : fail(`run ${r.runId} failed validation`, { details: { summary: r.summary } });
    },
  },
  {
    id: 'verify_legacy_freeze',
    title: 'Verify the legacy freeze held (no writes after T−0)',
    kind: 'auto',
    when: 'T−0',
    plan: () => ['read the loaded snapshot: no row created or updated after T−0 in the write tables'],
    run: async (ctx) => {
      const r = await ctx.deps.freezeProbe(ctx.instance, freezeAt(ctx));
      return r.pass
        ? ok('no writes after the freeze')
        : fail('writes after the freeze', { details: r.tables });
    },
  },
  {
    id: 'golden_checks',
    title: 'Validation V1–V12 on the migrated data',
    kind: 'auto',
    when: 'T−0',
    plan: (ctx) => [`pnpm migrate:legacy:validate --instance=${ctx.instance}: V1–V12 all green`],
    run: async (ctx) => {
      const r = await ctx.deps.revalidate(ctx.instance);
      return r.pass ? ok('V1–V12 green') : fail('validation failed', { details: { summary: r.summary } });
    },
  },
  decision('go_no_go_1', 'Go/no-go #1', 'T−0', ['delta_elt', 'verify_legacy_freeze', 'golden_checks']),
  manual('media_delta', 'Media delta, reindex, cache warm', 'T−0', 3, [
    'rclone copy --checksum of the media delta into legacy/{inst}/… (docs/runbooks/legacy-migration.md §3)',
    'search reindex and public cache warm',
  ]),
  {
    id: 'smoke',
    title: 'Smoke set',
    kind: 'auto',
    when: 'T−0',
    // The owner's device checks (listed in the plan) happen alongside.
    budgetMs: 8 * 60_000,
    plan: (ctx) => [
      ctx.options.baseUrl
        ? `HTTP: ${ctx.options.baseUrl} home, event listing, a migrated event over /api/v1, sign-in page`
        : 'HTTP checks skipped (no --base-url)',
      'owner (manual, listed in the report): bcrypt sign-in on both instances, an existing Sanctum token on a real device, a live $1 purchase + refund, a legacy order refund via its recorded charge path, a legacy QR in the old app and the PWA, seat finder, dashboard vs golden queries, email, push',
    ],
    run: async (ctx) => {
      const r = await ctx.deps.smoke(ctx.options.baseUrl, ctx.instance);
      const bad = r.checks.filter((c) => !c.ok);
      return bad.length
        ? fail(`smoke failed: ${bad.map((c) => c.name).join(', ')}`, { details: { checks: r.checks } })
        : ok(`${r.checks.length} check(s) passed`, { details: { checks: r.checks } });
    },
  },
  decision('go_no_go_2', 'Go/no-go #2', 'T−0', ['go_no_go_1', 'smoke']),
  {
    id: 'switch_routing',
    title: 'Switch host routing to the new platform',
    kind: 'auto',
    when: 'T−0 go-live',
    plan: (ctx) => [
      ...ctx.options.hosts.map(
        (h) => `host_route:${h} → next (the web front door reads it within 5 s; no DNS change)`,
      ),
      'owner: MySQL made read-only; the new scheduler on',
    ],
    run: async (ctx) => {
      for (const h of ctx.options.hosts)
        await ctx.deps.setHostRoute(h, 'next', reason(ctx, 'go-live'), actor(ctx));
      ctx.state.flippedAt ??= ctx.deps.now().toISOString();
      return ok(`${ctx.options.hosts.join(', ')} → new platform`);
    },
  },
  {
    id: 'unfreeze_new_app',
    title: 'Unfreeze the new app',
    kind: 'auto',
    when: 'T−0 end of the freeze',
    plan: () => ['end the read-only freeze: writes work again'],
    run: async (ctx) => {
      await ctx.deps.setFreeze(null, null, reason(ctx, 'freeze end'), actor(ctx));
      ctx.state.newAppFreeze = null;
      return ok('writes open');
    },
  },
  manual('comms_freeze_end', 'Freeze-end messages', 'T+0', 2, [
    'status page: maintenance over',
    'owner sends the freezeEnd messages to organizers and buyers (tickets stay valid; update the app)',
  ]),
];

/**
 * The abort path (roadmap §7.8 "Rollback triggers"). Before the flip: route back (a no-op), lift the
 * new app's freeze, put Laravel back. After the flip (before PONR): freeze the instance's orgs, copy
 * the new platform's writes back (reverse ETL), apply them to MySQL, route back, refund
 * post-cutover SCT orders at the provider, then tell people.
 */
export function abortSteps(ctx: CutoverContext): readonly Step[] {
  const flipped = Boolean(ctx.state.flippedAt);
  const cutoverAt = () => new Date(ctx.state.flippedAt ?? ctx.state.freezeAt ?? ctx.deps.now().toISOString());
  const steps: Step[] = [];
  if (flipped)
    steps.push(
      {
        id: 'freeze_instance',
        title: "Freeze the instance's orgs on the new platform",
        kind: 'auto',
        when: 'rollback',
        plan: () => ["read-only freeze of the instance's migrated orgs (beta tenants keep working)"],
        run: async (c) => {
          const orgIds = await c.deps.instanceOrgIds(c.instance);
          if (!orgIds.length) return fail('no migrated org found for the instance');
          await c.deps.setFreeze({ scope: 'orgs', orgIds }, null, reason(c, 'rollback'), actor(c));
          c.state.newAppFreeze = { scope: 'orgs', orgIds };
          return ok(`${orgIds.length} org(s)`);
        },
      },
      {
        id: 'reverse_etl',
        title: 'Reverse ETL: post-cutover writes back into the legacy shape',
        kind: 'auto',
        when: 'rollback',
        plan: (c) => [
          `pnpm migrate:legacy:reverse --instance=${c.instance} --cutover-at=<flip> --apply (reconciled to the cent)`,
          'the MySQL script is written to the report folder for review',
        ],
        run: async (c) => {
          const r = await c.deps.reverseEtl(c.instance, cutoverAt());
          const path = `${c.options.reportDir}/${c.instance}-rollback.sql`;
          await c.deps.writeFile(path, await c.deps.rollbackSql(c.instance));
          c.state.facts.rollbackSql = path;
          return r.pass
            ? ok(`reconciled; MySQL script ${path}`, { details: { report: r.report } })
            : fail('reverse ETL reconciliation failed', { details: { report: r.report } });
        },
      },
      manual('apply_mysql', 'Apply the reverse rows to MySQL', 'rollback', 3, [
        'review the generated MySQL script (report folder), then apply it to the legacy database',
        'MySQL user read-write again',
      ]),
    );
  steps.push({
    id: 'route_back',
    title: 'Route the hosts back to the legacy app',
    kind: 'auto',
    when: 'rollback',
    plan: (c) => c.options.hosts.map((h) => `host_route:${h} → legacy`),
    run: async (c) => {
      for (const h of c.options.hosts)
        await c.deps.setHostRoute(h, 'legacy', reason(c, 'rollback'), actor(c));
      return ok(`${c.options.hosts.join(', ')} → legacy`);
    },
  });
  if (!flipped)
    steps.push({
      id: 'lift_new_freeze',
      title: "Lift the new app's freeze",
      kind: 'auto',
      when: 'abort',
      plan: () => ['end the read-only freeze the cutover started'],
      run: async (c) => {
        await c.deps.setFreeze(null, null, reason(c, 'abort'), actor(c));
        c.state.newAppFreeze = null;
        return ok('lifted');
      },
    });
  steps.push(
    manual('unfreeze_legacy', 'Put the legacy app back in service', 'rollback', 2, [
      'Laravel out of maintenance; scheduler and workers started; checkout resumed',
    ]),
  );
  if (flipped)
    steps.push({
      id: 'refund_sct',
      title: 'Refund post-cutover platform (SCT) orders at the provider',
      kind: 'auto',
      when: 'rollback',
      plan: (c) => [
        c.mode === 'rehearsal'
          ? 'rehearsal: refund the simulated SCT order through the fake provider (exactly once)'
          : 'list eligible orders (plan); the owner runs the refunds for the orders they choose (pending owner)',
      ],
      run: async (c) => {
        const orderIds =
          c.mode === 'rehearsal' ? ((c.state.facts.simulatedOrders as string[] | undefined) ?? []) : null;
        const r = await c.deps.rollbackRefunds(c.instance, cutoverAt(), orderIds);
        const failed = r.items.filter((i) => i.status === 'failed' || i.status === 'transfer_released');
        const refunded = r.items.filter((i) => i.status === 'succeeded' || i.status === 'already_refunded');
        return failed.length
          ? fail(`${failed.length} order(s) not refunded`, { details: { items: r.items } })
          : ok(`${refunded.length} refunded, ${r.items.length - refunded.length} planned`, {
              details: { items: r.items },
            });
      },
    });
  steps.push(
    manual('comms_rollback', 'Rollback messages', 'rollback', 2, [
      'owner sends the rollback messages to organizers and buyers; status page updated',
    ]),
  );
  return steps;
}
