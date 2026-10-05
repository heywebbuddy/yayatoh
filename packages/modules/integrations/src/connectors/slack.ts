import { defineConnector } from '../sdk/connector.ts';
import { slackAuthTest } from '../slack/api.ts';
import { slackFakeProvider } from '../slack/fake.ts';

/**
 * Slack (M6.4c, decision P6-4 order 5): notifications only. OAuth through the `IntegrationAuth`
 * port (Nango's `slack` integration; the fake in dev and CI), a channel picker, alerts from the
 * M3.2b engine and a daily digest, sent by `runSlackDispatch`. It syncs no records: its runs are
 * the connection's health check (`auth.test`), so a revoked app is noticed by the next run.
 * Scopes: post to channels the app is in, and list channels for the picker.
 */
export const slackConnector = defineConnector({
  key: 'slack',
  name: 'Slack',
  providerConfigKey: 'slack',
  scopes: ['chat:write', 'channels:read', 'groups:read'],
  entitlement: 'integrations',
  availability: 'general',
  purpose: 'notifications',
  fake: slackFakeProvider,
  objects: [],
  health: (io) => slackAuthTest(io.client),
});
