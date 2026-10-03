import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  isDomainError,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { organizationBrandTx, organizationLocaleTx } from '@yayatoh/tenancy';
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthRef, type IntegrationAuth, isProviderError } from '../auth/port.ts';
import { runSync } from '../engine.ts';
import { connections, SLACK_MESSAGE_KINDS, slackMessages, slackSettings } from '../schema.ts';
import { postSlackMessage } from './api.ts';
import { digestFactsTx } from './digest.ts';
import {
  digestAmounts,
  renderSlackAlert,
  renderSlackDigest,
  renderSlackTest,
  SLACK_SEVERITIES,
  type SlackMessage,
  slackPiiProblems,
} from './render.ts';
import { localDay, nextDigestAt } from './schedule.ts';
import { hasFinanceTx, SLACK_CONNECTOR } from './settings.ts';

/**
 * The Slack sender (M6.4c), run by the worker's leader for orgs with Slack work and by the dev
 * drain. One pass for one org: queue the digests that are due, claim the messages that are due
 * (with a lease, so concurrent passes and retries post each one once), check each connection
 * through the `IntegrationAuth` port, render, re-check for personal data, post, record.
 *
 * - **Once per day per channel:** a digest's dedupe key is its local day (`digest:YYYY-MM-DD`),
 *   unique per connection and channel, so a retried pass, a second worker or a DST change never
 *   queues a second one. A digest whose time passed more than `STALE_DIGEST_MS` ago (the worker
 *   was down) is skipped, not sent late.
 * - **Revoked stops at once:** a connection that is no longer active has its queued messages
 *   cancelled; a connection the port reports revoked (or Slack refuses with an auth error) is
 *   marked revoked through the engine's run (errors inbox, `integrations.connection_revoked@1`),
 *   and nothing more is sent to it.
 */

export const SLACK_ACTOR = { type: 'system', name: 'integrations.slack' } as const;
export const SLACK_PERMISSION = 'platform:integrations.slack';
const LEASE_MS = 5 * 60_000;
/** Minutes before each automatic retry of a failed message. */
const RETRY_MINUTES = [1, 5, 15, 60] as const;
export const MAX_SLACK_ATTEMPTS = RETRY_MINUTES.length + 1;
export const SLACK_CLAIM_BATCH = 50;
export const STALE_DIGEST_MS = 12 * 60 * 60_000;
/** Slack refusals that will not change by retrying. */
const FINAL_CODES = new Set(['channel_not_found', 'not_in_channel', 'is_archived', 'pii_blocked', 'no_text']);

export interface SlackDeps {
  readonly auth: IntegrationAuth;
  /** The console's origin, for links in messages (`https://…`; other origins get no links). */
  readonly appOrigin: string;
}

const code = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 60) || 'error';

/** Queue every digest that is due (system actor). */
export const queueSlackDigestsCommand = tenantCommand({
  name: 'integrations.queueSlackDigests',
  input: z.object({}),
  output: z.object({ queued: z.int(), skipped: z.int() }),
  entitlement: 'integrations',
  permission: SLACK_PERMISSION,
  handler: async ({ ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const zone = (await organizationBrandTx(tx, orgId))?.timezone ?? 'UTC';
    const due = await tx
      .select({ settings: slackSettings })
      .from(slackSettings)
      .innerJoin(
        connections,
        and(eq(connections.orgId, slackSettings.orgId), eq(connections.id, slackSettings.connectionId)),
      )
      .where(
        and(
          eq(slackSettings.digestEnabled, true),
          isNotNull(slackSettings.channelId),
          lte(slackSettings.digestNextAt, ctx.now),
          eq(connections.status, 'active'),
          eq(connections.connector, SLACK_CONNECTOR),
        ),
      )
      .for('update', { of: slackSettings });
    let queued = 0;
    let skipped = 0;
    for (const { settings: s } of due) {
      if (!s.digestNextAt || !s.channelId) continue;
      if (ctx.now.getTime() - s.digestNextAt.getTime() <= STALE_DIGEST_MS) {
        const day = localDay(s.digestNextAt, zone);
        const inserted = await tx
          .insert(slackMessages)
          .values({
            orgId,
            connectionId: s.connectionId,
            channelId: s.channelId,
            kind: 'digest',
            dedupeKey: `digest:${day}`,
            payload: { day },
            nextAttemptAt: ctx.now,
          })
          .onConflictDoNothing()
          .returning({ id: slackMessages.id });
        queued += inserted.length;
      } else skipped += 1;
      await tx
        .update(slackSettings)
        .set({ digestNextAt: nextDigestAt(ctx.now, s.digestTime, zone), updatedAt: ctx.now })
        .where(eq(slackSettings.id, s.id));
    }
    return { queued, skipped };
  },
});

const ClaimedMessage = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  authConnectionId: z.string(),
  connectedBy: z.uuid().nullable(),
  channelId: z.string(),
  kind: z.enum(SLACK_MESSAGE_KINDS),
  payload: z.record(z.string(), z.unknown()),
  includeFinance: z.boolean(),
  financeOptedBy: z.uuid().nullable(),
});
type ClaimedMessage = z.infer<typeof ClaimedMessage>;

/** Claim the messages that are due (pending, retry due, or a dead sender's lease ran out). */
export const claimSlackMessagesCommand = tenantCommand({
  name: 'integrations.claimSlackMessages',
  input: z.object({ connectionId: z.uuid().nullable().default(null) }),
  output: z.object({ cancelled: z.int(), messages: z.array(ClaimedMessage) }),
  entitlement: 'integrations',
  permission: SLACK_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    // A connection that is no longer active sends nothing more: its queue is cancelled.
    const cancelled = await tx
      .update(slackMessages)
      .set({ status: 'cancelled', errorCode: 'connection_inactive', leaseUntil: null, nextAttemptAt: null })
      .where(
        and(
          inArray(slackMessages.status, ['pending', 'sending', 'failed']),
          sql`exists (select 1 from ${connections} c where c.org_id = ${slackMessages.orgId} and c.id = ${slackMessages.connectionId} and c.status <> 'active')`,
        ),
      )
      .returning({ id: slackMessages.id });
    const due = await tx
      .select({ m: slackMessages, c: connections, s: slackSettings })
      .from(slackMessages)
      .innerJoin(
        connections,
        and(eq(connections.orgId, slackMessages.orgId), eq(connections.id, slackMessages.connectionId)),
      )
      .leftJoin(
        slackSettings,
        and(
          eq(slackSettings.orgId, slackMessages.orgId),
          eq(slackSettings.connectionId, slackMessages.connectionId),
        ),
      )
      .where(
        and(
          eq(connections.status, 'active'),
          isNotNull(connections.authConnectionId),
          input.connectionId ? eq(slackMessages.connectionId, input.connectionId) : undefined,
          or(
            and(
              inArray(slackMessages.status, ['pending', 'failed']),
              lte(slackMessages.nextAttemptAt, ctx.now),
            ),
            and(eq(slackMessages.status, 'sending'), lte(slackMessages.leaseUntil, ctx.now)),
          ),
        ),
      )
      .orderBy(asc(slackMessages.createdAt), asc(slackMessages.id))
      .limit(SLACK_CLAIM_BATCH)
      .for('update', { of: slackMessages, skipLocked: true });
    if (due.length)
      await tx
        .update(slackMessages)
        .set({
          status: 'sending',
          attempts: sql`${slackMessages.attempts} + 1`,
          leaseUntil: new Date(ctx.now.getTime() + LEASE_MS),
          updatedAt: ctx.now,
        })
        .where(
          inArray(
            slackMessages.id,
            due.map((d) => d.m.id),
          ),
        );
    return {
      cancelled: cancelled.length,
      messages: due.map(({ m, c, s }) => ({
        id: m.id,
        connectionId: m.connectionId,
        authConnectionId: c.authConnectionId ?? '',
        connectedBy: c.connectedBy,
        channelId: m.channelId,
        kind: m.kind as ClaimedMessage['kind'],
        payload: m.payload,
        includeFinance: s?.includeFinance ?? false,
        financeOptedBy: s?.financeOptedBy ?? null,
      })),
    };
  },
});

/** Record how a claimed message went: sent, failed (retried later unless final) or cancelled. */
export const finishSlackMessageCommand = tenantCommand({
  name: 'integrations.finishSlackMessage',
  input: z.object({
    messageId: z.uuid(),
    outcome: z.enum(['sent', 'failed', 'cancelled']),
    ts: z.string().max(40).nullable().default(null),
    errorCode: z.string().max(60).nullable().default(null),
    retryable: z.boolean().default(true),
  }),
  output: z.object({ status: z.string() }),
  entitlement: 'integrations',
  permission: SLACK_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    const [m] = await tx
      .select()
      .from(slackMessages)
      .where(eq(slackMessages.id, input.messageId))
      .for('update');
    if (!m) throw new DomainError('not_found');
    if (m.status !== 'sending') return { status: m.status };
    const base = { leaseUntil: null, updatedAt: ctx.now };
    if (input.outcome === 'sent') {
      await tx
        .update(slackMessages)
        .set({
          ...base,
          status: 'sent',
          sentAt: ctx.now,
          providerTs: input.ts,
          errorCode: null,
          nextAttemptAt: null,
        })
        .where(eq(slackMessages.id, m.id));
      return { status: 'sent' };
    }
    const errorCode = input.errorCode ? code(input.errorCode) : null;
    if (input.outcome === 'cancelled') {
      await tx
        .update(slackMessages)
        .set({ ...base, status: 'cancelled', errorCode, nextAttemptAt: null })
        .where(eq(slackMessages.id, m.id));
      return { status: 'cancelled' };
    }
    const wait = RETRY_MINUTES[m.attempts - 1];
    const retry = input.retryable && wait !== undefined && !FINAL_CODES.has(errorCode ?? '');
    await tx
      .update(slackMessages)
      .set({
        ...base,
        status: 'failed',
        errorCode,
        nextAttemptAt: retry ? new Date(ctx.now.getTime() + (wait ?? 0) * 60_000) : null,
      })
      .where(eq(slackMessages.id, m.id));
    return { status: 'failed' };
  },
});

interface OrgFacts {
  readonly name: string;
  readonly slug: string;
  readonly timeZone: string;
  readonly locale: string;
}

const consoleUrl = (origin: string, slug: string, path: string) =>
  /^https:\/\//.test(origin) ? `${origin.replace(/\/$/, '')}/o/${slug}${path}` : '';

/** What one claimed message says, rendered from the current facts; null when there is nothing to say. */
async function renderTx(
  tx: TenantTx,
  orgId: string,
  org: OrgFacts,
  m: ClaimedMessage,
  appOrigin: string,
): Promise<{ message: SlackMessage; amounts: string[] } | null> {
  if (m.kind === 'test')
    return {
      message: renderSlackTest({
        locale: org.locale,
        orgName: org.name,
        url: consoleUrl(appOrigin, org.slug, '/integrations'),
      }),
      amounts: [],
    };
  if (m.kind === 'alert') {
    const p = m.payload;
    const severity = SLACK_SEVERITIES.find((s) => s === p.severity) ?? 'warning';
    const eventId = typeof p.eventId === 'string' ? p.eventId : null;
    const event = eventId ? await findEventTx(tx, eventId) : null;
    if (eventId && !event) return null;
    return {
      message: renderSlackAlert({
        locale: org.locale,
        orgName: org.name,
        rule: String(p.rule ?? ''),
        severity,
        count: typeof p.count === 'number' ? p.count : 0,
        eventName: event?.name ?? null,
        url: consoleUrl(appOrigin, org.slug, typeof p.href === 'string' ? p.href : ''),
      }),
      amounts: [],
    };
  }
  const day =
    typeof m.payload.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.payload.day) ? m.payload.day : null;
  if (!day) return null;
  const facts = await digestFactsTx(tx, orgId, day, org.timeZone, consoleUrl(appOrigin, org.slug, ''));
  // Amounts only while the opt-in stands: the connection's owner opted in and still has finance access.
  const finance =
    m.includeFinance &&
    m.financeOptedBy !== null &&
    m.financeOptedBy === m.connectedBy &&
    (await hasFinanceTx(tx, m.financeOptedBy));
  return {
    message: renderSlackDigest(facts, { locale: org.locale, includeFinance: finance }),
    amounts: finance ? [] : digestAmounts(facts, org.locale),
  };
}

export interface SlackDispatchResult {
  readonly queued: number;
  readonly sent: number;
  readonly failed: number;
  readonly cancelled: number;
  /** Connections found revoked in this pass (now marked so). */
  readonly revoked: readonly string[];
}

/**
 * One pass for one org (the worker's job and the dev drain; the connection page's test send for
 * one connection). Network calls happen between commands, never inside a transaction.
 */
export async function runSlackDispatch(
  orgId: string,
  deps: SlackDeps,
  ports: CommandPorts<TenantTx>,
  opts: { now?: Date; connectionId?: string } = {},
): Promise<SlackDispatchResult> {
  const now = opts.now ?? new Date();
  const ctx: Ctx = createCtx({ orgId, actor: SLACK_ACTOR, now });
  let queued = 0;
  let claim: { cancelled: number; messages: ClaimedMessage[] };
  try {
    if (!opts.connectionId) queued = (await executeCommand(queueSlackDigestsCommand, {}, ctx, ports)).queued;
    claim = await executeCommand(
      claimSlackMessagesCommand,
      { connectionId: opts.connectionId ?? null },
      ctx,
      ports,
    );
  } catch (err) {
    if (isDomainError(err) && err.code === 'module_not_enabled')
      return { queued: 0, sent: 0, failed: 0, cancelled: 0, revoked: [] };
    throw err;
  }
  let sent = 0;
  let failed = 0;
  let cancelled = claim.cancelled;
  const revoked: string[] = [];
  const finish = async (
    m: ClaimedMessage,
    outcome: 'sent' | 'failed' | 'cancelled',
    extra: { ts?: string; errorCode?: string; retryable?: boolean } = {},
  ) => {
    await executeCommand(
      finishSlackMessageCommand,
      {
        messageId: m.id,
        outcome,
        ts: extra.ts ?? null,
        errorCode: extra.errorCode ?? null,
        retryable: extra.retryable ?? true,
      },
      ctx,
      ports,
    );
    if (outcome === 'sent') sent += 1;
    else if (outcome === 'failed') failed += 1;
    else cancelled += 1;
  };
  if (claim.messages.length === 0) return { queued, sent, failed, cancelled, revoked };
  const org = await withTenant(ctx, async (tx): Promise<OrgFacts> => {
    const b = await organizationBrandTx(tx, orgId);
    return {
      name: b?.name ?? '',
      slug: b?.slug ?? '',
      timeZone: b?.timezone ?? 'UTC',
      locale: await organizationLocaleTx(tx, orgId),
    };
  });
  const byConnection = new Map<string, ClaimedMessage[]>();
  for (const m of claim.messages)
    byConnection.set(m.connectionId, [...(byConnection.get(m.connectionId) ?? []), m]);
  for (const [connectionId, messages] of byConnection) {
    const first = messages[0] as ClaimedMessage;
    const ref: AuthRef = {
      orgId,
      connectionId,
      providerConfigKey: SLACK_CONNECTOR,
      authConnectionId: first.authConnectionId,
    };
    // Revoked (in Yayatoh's run or at Slack): mark it through the engine and send nothing more.
    const revoke = async (rest: readonly ClaimedMessage[]) => {
      revoked.push(connectionId);
      await runSync(orgId, connectionId, { auth: deps.auth }, ports, { now, force: true });
      for (const m of rest) await finish(m, 'cancelled', { errorCode: 'auth_revoked' });
    };
    const status = await deps.auth.check(ref).catch(() => null);
    if (status === 'revoked') {
      await revoke(messages);
      continue;
    }
    if (status === null) {
      for (const m of messages) await finish(m, 'failed', { errorCode: 'provider_unavailable' });
      continue;
    }
    const client = deps.auth.client(ref);
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as ClaimedMessage;
      let rendered: Awaited<ReturnType<typeof renderTx>>;
      try {
        rendered = await withTenant(ctx, (tx) => renderTx(tx, orgId, org, m, deps.appOrigin));
      } catch {
        await finish(m, 'failed', { errorCode: 'render_failed' });
        continue;
      }
      if (!rendered) {
        await finish(m, 'cancelled', { errorCode: 'nothing_to_send' });
        continue;
      }
      if (slackPiiProblems(rendered.message, { amounts: rendered.amounts }).length) {
        await finish(m, 'failed', { errorCode: 'pii_blocked', retryable: false });
        continue;
      }
      try {
        const r = await postSlackMessage(client, m.channelId, rendered.message, m.id);
        await finish(m, 'sent', { ts: r.ts });
      } catch (err) {
        if (isProviderError(err) && err.auth) {
          await finish(m, 'cancelled', { errorCode: 'auth_revoked' });
          await revoke(messages.slice(i + 1));
          break;
        }
        await finish(m, 'failed', { errorCode: isProviderError(err) ? err.code : 'send_failed' });
      }
    }
  }
  return { queued, sent, failed, cancelled, revoked };
}
