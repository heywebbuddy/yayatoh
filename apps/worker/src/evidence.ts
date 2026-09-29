import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, executeQuery } from '@yayatoh/kernel';
import { auditLogQuery, createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

/**
 * The seed orgs `pnpm seed` creates (apps/web/src/server/personas.ts SEED_ORGS). The SOC 2
 * evidence bundle (M5.11a) samples the audit log of these orgs only, in the throwaway CI
 * database; the bundle builder refuses any other org.
 */
export const SEEDED_ORG_SLUGS = ['lakeside-events', 'rosewood-weddings', 'harbor-arts'] as const;

/** Hosts a sample may be read from: the local compose service and the CI service container. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);

/** Refuse to run against anything but a local or CI database (never production). */
export function assertLocalDatabase(urls: readonly (string | undefined)[]): void {
  for (const u of urls) {
    if (!u) continue;
    const host = new URL(u).hostname;
    if (!LOCAL_HOSTS.has(host))
      throw new Error(`evidence audit samples run only against a local or CI database, not ${host}`);
  }
}

export interface AuditSampleOptions {
  readonly slugs?: readonly string[];
  readonly perOrg?: number;
  readonly now?: Date;
  /** The owner's production run (runbook): stamped so it can never enter the CI bundle. */
  readonly production?: boolean;
}

/** The confirmation the owner sets for a production read (docs/runbooks/evidence-production.md). */
export const PRODUCTION_CONFIRM = 'owner-approved';

/**
 * CLI arguments of `scripts/audit-sample.ts`. By default only the seeded orgs of a local or CI
 * database. `--production` needs `--orgs` (the orgs the auditor picked) and
 * `EVIDENCE_PRODUCTION_READ=owner-approved`: it is the owner's step, never CI's.
 */
export function parseSampleArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>) {
  const args = argv.filter((a) => a !== '--');
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = value('out');
  if (!out) throw new Error('--out <file> is required');
  const production = args.includes('--production');
  const orgs = value('orgs')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const perOrg = Number(value('per-org') ?? 25);
  if (!Number.isInteger(perOrg) || perOrg < 1 || perOrg > 100) throw new Error('--per-org must be 1–100');
  if (production) {
    if (env.EVIDENCE_PRODUCTION_READ !== PRODUCTION_CONFIRM)
      throw new Error(`--production needs EVIDENCE_PRODUCTION_READ=${PRODUCTION_CONFIRM} (owner only)`);
    if (!orgs?.length) throw new Error('--production needs --orgs: the orgs the auditor sampled');
    return { out, production, slugs: orgs, perOrg };
  }
  if (orgs) throw new Error('--orgs is only for --production; CI samples the seeded orgs');
  assertLocalDatabase([env.DATABASE_URL, env.PLATFORM_READER_DATABASE_URL]);
  return { out, production, slugs: [...SEEDED_ORG_SLUGS], perOrg };
}

/**
 * Audit-log samples for the evidence bundle. Finds the seeded orgs with one audited
 * platform_reader read (slug → id only), then reads each org's log through the existing
 * `platform.auditLog` query under that org's RLS as a system actor: the same allowlisted
 * entries and hash-chain check an org owner sees in Settings → Activity.
 */
export async function sampleAuditLog(o: AuditSampleOptions = {}) {
  const slugs = [...(o.slugs ?? SEEDED_ORG_SLUGS)];
  const perOrg = o.perOrg ?? 25;
  const orgs = await withPlatformReader(
    {
      actor: 'system:evidence',
      reason: o.production
        ? 'SOC 2 evidence: owner-run audit-log sample of auditor-selected orgs'
        : 'SOC 2 evidence bundle: audit-log sample of seeded orgs',
    },
    (tx) =>
      tx.execute<{ id: string; slug: string }>(
        sql`select id, slug from tenancy.organizations where slug in (${sql.join(
          slugs.map((s) => sql`${s}`),
          sql`, `,
        )}) order by slug`,
      ),
  );
  const out = [];
  for (const org of orgs) {
    const ctx = createCtx({ orgId: org.id, actor: { type: 'system', name: 'compliance.evidence' } });
    const page = await executeQuery(auditLogQuery, { limit: perOrg }, ctx, ports);
    out.push({
      slug: org.slug,
      chain: page.chain,
      entries: page.entries.map((e) => ({
        seq: e.seq,
        at: e.at.toISOString(),
        actor: e.actor,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        details: e.details,
      })),
    });
  }
  return {
    source: o.production ? ('production-owner-run' as const) : ('seeded-ci-database' as const),
    generatedAt: (o.now ?? new Date()).toISOString(),
    perOrg,
    orgs: out,
  };
}
