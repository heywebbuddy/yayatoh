import type { FakeAccount, FakeProvider } from '../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../auth/port.ts';

/**
 * The fake Slack Web API (M6.4c) behind the fake `IntegrationAuth`: a workspace with a few
 * channels, `conversations.list`, `chat.postMessage` and `auth.test`, answered the way Slack does
 * (HTTP 200 with `ok: false` and an error code for refusals). Posted messages are kept on the
 * account so tests and the dev route can read what the channel received. No network.
 */

export interface FakeSlackChannel {
  readonly id: string;
  readonly name: string;
  readonly is_private: boolean;
  readonly is_member: boolean;
  readonly is_archived: boolean;
}

export interface FakeSlackMessage {
  readonly channel: string;
  readonly ts: string;
  readonly text: string;
  readonly blocks: unknown[];
}

interface SlackData {
  seq: number;
  channels: FakeSlackChannel[];
  messages: FakeSlackMessage[];
}

/** The fake workspace's channels (one private, one the app is not in, one archived). */
export const FAKE_SLACK_CHANNELS: readonly FakeSlackChannel[] = [
  { id: 'C01GENERAL', name: 'general', is_private: false, is_member: true, is_archived: false },
  { id: 'C02EVENTOPS', name: 'event-ops', is_private: false, is_member: true, is_archived: false },
  { id: 'C03DOORS', name: 'door-team', is_private: false, is_member: false, is_archived: false },
  { id: 'G04FINANCE', name: 'finance', is_private: true, is_member: true, is_archived: false },
  { id: 'C05OLD', name: 'old-announcements', is_private: false, is_member: true, is_archived: true },
];

const PAGE = 2;

function slackData(a: FakeAccount): SlackData {
  return a.data as SlackData;
}

/** What the fake channel received (tests and the dev route). */
export const fakeSlackMessages = (a: FakeAccount): readonly FakeSlackMessage[] => slackData(a).messages;

const ok = (body: Record<string, unknown>): ProviderResponse => ({
  status: 200,
  body: { ok: true, ...body },
});
const refuse = (error: string): ProviderResponse => ({ status: 200, body: { ok: false, error } });

export const slackFakeProvider: FakeProvider = {
  accountLabel: 'Fake Workspace (sandbox)',
  seed: (): SlackData => ({ seq: 0, channels: FAKE_SLACK_CHANNELS.map((c) => ({ ...c })), messages: [] }),
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = slackData(account);
    if (req.method === 'GET' && req.path === '/auth.test')
      return ok({ team: 'Fake Workspace', team_id: 'T0FAKE', bot_id: 'B0FAKE' });
    if (req.method === 'GET' && req.path === '/conversations.list') {
      const live = d.channels.filter((c) => req.query?.exclude_archived !== 'true' || !c.is_archived);
      const start = Number(/^c:(\d+)$/.exec(req.query?.cursor ?? '')?.[1] ?? 0);
      const page = live.slice(start, start + PAGE);
      const next = start + PAGE < live.length ? `c:${start + PAGE}` : '';
      return ok({ channels: page, response_metadata: { next_cursor: next } });
    }
    if (req.method === 'POST' && req.path === '/chat.postMessage') {
      const body = (req.body ?? {}) as { channel?: unknown; text?: unknown; blocks?: unknown };
      const channel = d.channels.find((c) => c.id === body.channel);
      if (!channel || channel.is_archived) return refuse('channel_not_found');
      if (!channel.is_member) return refuse('not_in_channel');
      if (typeof body.text !== 'string' || !body.text) return refuse('no_text');
      d.seq += 1;
      const ts = `${1_790_000_000 + d.seq}.000100`;
      d.messages.push({
        channel: channel.id,
        ts,
        text: body.text,
        blocks: Array.isArray(body.blocks) ? body.blocks : [],
      });
      return ok({ channel: channel.id, ts });
    }
    return { status: 404, body: { ok: false, error: 'unknown_method' } };
  },
};
