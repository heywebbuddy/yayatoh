import { type ProviderClient, ProviderError } from '../auth/port.ts';
import type { SlackMessage } from './render.ts';

/**
 * The Slack Web API calls the connector makes (M6.4c), through the `IntegrationAuth` port (Nango's
 * proxy in production, the fake in dev and CI): the token never reaches this code. Slack answers
 * refusals with HTTP 200 and `ok: false`; they become `ProviderError`s with Slack's error code, and
 * the ones that mean the token is gone are 401s (the engine then marks the connection revoked).
 */

export interface SlackChannel {
  readonly id: string;
  readonly name: string;
  readonly isPrivate: boolean;
  /** Whether the app is in the channel (Slack refuses posts to channels it is not in). */
  readonly isMember: boolean;
}

/** Slack error codes that mean the connection no longer works. */
const AUTH_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'no_permission',
  'missing_scope',
  'team_access_not_granted',
]);
const RETRY_ERRORS = new Set(['ratelimited', 'service_unavailable', 'fatal_error', 'internal_error']);
const CHANNEL_ID = /^[CGD][A-Z0-9]{2,20}$/;
const CHANNEL_NAME = /^[\p{Ll}\p{Lo}\p{N}_.-]{1,80}$/u;
/** How many channel pages the picker reads (Slack pages of 200; enough for a workspace). */
const MAX_CHANNEL_PAGES = 10;

/** Slack's own answer as a `ProviderError` (code only: never the body). */
function check(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.ok === true) return b;
  const error =
    typeof b.error === 'string' ? b.error.replace(/[^a-z0-9_]/g, '_').slice(0, 60) : 'slack_error';
  if (AUTH_ERRORS.has(error)) throw new ProviderError(401, error);
  if (RETRY_ERRORS.has(error)) throw new ProviderError(503, error);
  throw new ProviderError(400, error || 'slack_error');
}

export const isSlackChannelId = (id: string) => CHANNEL_ID.test(id);

/** The workspace's live channels the picker offers, by name (archived ones left out). */
export async function listSlackChannels(client: ProviderClient): Promise<SlackChannel[]> {
  const out: SlackChannel[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
    const res = await client.request({
      method: 'GET',
      path: '/conversations.list',
      query: {
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '200',
        ...(cursor ? { cursor } : {}),
      },
    });
    const b = check(res.body);
    for (const raw of Array.isArray(b.channels) ? b.channels : []) {
      const c = raw as Record<string, unknown>;
      if (typeof c.id !== 'string' || typeof c.name !== 'string') continue;
      if (!CHANNEL_ID.test(c.id) || !CHANNEL_NAME.test(c.name) || c.is_archived === true) continue;
      out.push({ id: c.id, name: c.name, isPrivate: c.is_private === true, isMember: c.is_member === true });
    }
    const meta = (b.response_metadata ?? {}) as { next_cursor?: unknown };
    cursor = typeof meta.next_cursor === 'string' ? meta.next_cursor : '';
    if (!cursor) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Post one message; returns Slack's message timestamp (its id in the channel). */
export async function postSlackMessage(
  client: ProviderClient,
  channelId: string,
  message: SlackMessage,
  idempotencyKey: string,
): Promise<{ readonly ts: string }> {
  const res = await client.request({
    method: 'POST',
    path: '/chat.postMessage',
    body: {
      channel: channelId,
      text: message.text,
      blocks: message.blocks,
      unfurl_links: false,
      unfurl_media: false,
    },
    idempotencyKey,
  });
  const b = check(res.body);
  return { ts: typeof b.ts === 'string' ? b.ts.slice(0, 40) : '' };
}

/** `auth.test`: does the app's token still work? (The connection's health check.) */
export async function slackAuthTest(client: ProviderClient): Promise<void> {
  check((await client.request({ method: 'GET', path: '/auth.test' })).body);
}
