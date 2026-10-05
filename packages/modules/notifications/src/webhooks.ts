import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, createCtx, executeCommand } from '@yayatoh/kernel';
import { type DeliveryEvent, orgOfMessage, recordDeliveryEventsCommand } from './delivery.ts';
import { inboundOrgs, recordInboundKeywordCommand } from './inbound.ts';
import { recordProviderHealth } from './provider-health.ts';
import {
  type InboundKeyword,
  type ProviderWebhookAdapter,
  type VerifiedWebhook,
  type WebhookRequest,
  WebhookVerificationError,
} from './providers/types.ts';

/**
 * The webhook pipeline for every provider (M3.5b): verify the signature on the raw body, count it
 * in provider health, then record each delivery event under its org, which comes from **our**
 * message id (SECURITY DEFINER lookup), never from the payload; and apply each inbound keyword to
 * the orgs it concerns. Provider events are deduplicated by their ids inside the commands, so a
 * provider's retries and replays change nothing.
 */
export interface IngestResult {
  recorded: number;
  duplicate: number;
  unknown: number;
  suppressed: number;
  /** Messages handed to the next channel of their chain. */
  fellBack: number;
  keywords: number;
}

export interface WebhookOutcome {
  readonly ok: boolean;
  readonly failure?: string;
  readonly result?: IngestResult;
  readonly confirmed?: boolean;
  /** HELP was asked: the sender's name for the reply (an org's own number), or null (shared). */
  readonly help?: { readonly sender: string | null } | null;
}

type Ports = CommandPorts<TenantTx>;

export async function ingestDeliveryEvents(
  provider: string,
  events: readonly DeliveryEvent[],
  ports: Ports,
): Promise<IngestResult> {
  const total: IngestResult = {
    recorded: 0,
    duplicate: 0,
    unknown: 0,
    suppressed: 0,
    fellBack: 0,
    keywords: 0,
  };
  const byOrg = new Map<string, DeliveryEvent[]>();
  for (const e of events) {
    const org = await orgOfMessage(e.messageId);
    if (!org) {
      total.unknown += 1;
      continue;
    }
    byOrg.set(org, [...(byOrg.get(org) ?? []), e]);
  }
  for (const [orgId, list] of byOrg)
    for (let i = 0; i < list.length; i += 100) {
      const ctx = createCtx({ orgId, actor: { type: 'system', name: `webhook:${provider}` } });
      const r = await executeCommand(
        recordDeliveryEventsCommand,
        { provider, events: list.slice(i, i + 100) },
        ctx,
        ports,
      );
      total.recorded += r.recorded;
      total.duplicate += r.duplicate;
      total.unknown += r.unknown;
      total.suppressed += r.suppressed;
      total.fellBack += r.fellBack;
    }
  return total;
}

export async function ingestInboundKeywords(
  provider: string,
  keywords: readonly InboundKeyword[],
  ports: Ports,
): Promise<{ applied: number; help: { sender: string | null } | null }> {
  let applied = 0;
  let help: { sender: string | null } | null = null;
  for (const k of keywords) {
    const orgs = await inboundOrgs({ channel: k.channel, provider, senderRef: k.senderRef, from: k.from });
    const names: string[] = [];
    for (const o of orgs) {
      const ctx = createCtx({ orgId: o.orgId, actor: { type: 'system', name: `webhook:${provider}` } });
      const r = await executeCommand(
        recordInboundKeywordCommand,
        {
          provider,
          id: k.id,
          channel: k.channel,
          keyword: k.keyword,
          from: k.from,
          receivedAt: k.receivedAt,
        },
        ctx,
        ports,
      );
      if (r.recorded) applied += 1;
      if (o.dedicated) names.push(r.orgName);
    }
    if (k.keyword === 'help') help = { sender: names.length === 1 ? (names[0] ?? null) : null };
  }
  return { applied, help };
}

/** Verify and ingest one webhook delivery. Verification failures are counted, never thrown. */
export async function handleProviderWebhook(
  adapter: ProviderWebhookAdapter,
  req: WebhookRequest,
  ports: Ports,
): Promise<WebhookOutcome> {
  let verified: VerifiedWebhook;
  try {
    if (req.rawBody.length > 256 * 1024) throw new WebhookVerificationError('malformed', 'too large');
    verified = await adapter.verify(req);
  } catch (err) {
    const failure = err instanceof WebhookVerificationError ? err.failure : 'error';
    await recordProviderHealth([
      { provider: adapter.name, kind: 'webhook_rejected', error: `webhook ${failure}` },
    ]);
    return { ok: false, failure };
  }
  await recordProviderHealth([{ provider: adapter.name, kind: 'webhook' }]);
  const result = await ingestDeliveryEvents(adapter.name, verified.events, ports);
  const inbound = await ingestInboundKeywords(adapter.name, verified.inbound, ports);
  result.keywords = inbound.applied;
  return { ok: true, result, confirmed: verified.confirmed ?? false, help: inbound.help };
}
