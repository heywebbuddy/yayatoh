import type { ConnectorDefinition } from '../sdk/connector.ts';
import { demoConnector } from './demo.ts';
import { hubspotConnector } from './hubspot/index.ts';
import { klaviyoConnector } from './klaviyo/index.ts';
import { mailchimpConnector } from './mailchimp/index.ts';

/**
 * Every connector (M6.4a). M6.4b–d append theirs here (Eventbrite, Google Sheets, Zapier, Slack,
 * Mailchimp, HubSpot, Klaviyo), in the order of decision P6-4.
 */
export const CONNECTORS: readonly ConnectorDefinition[] = [
  demoConnector,
  // M6.4d (P6-4 order: Mailchimp and HubSpot, then Klaviyo).
  mailchimpConnector,
  hubspotConnector,
  klaviyoConnector,
];

export function connectorByKey(key: string): ConnectorDefinition | null {
  return CONNECTORS.find((c) => c.key === key) ?? null;
}

/** The connectors this deployment offers: fake-only ones only where the auth port is the fake. */
export function offeredConnectors(provider: 'nango' | 'fake' | null): ConnectorDefinition[] {
  if (!provider) return [];
  return CONNECTORS.filter((c) => c.availability === 'general' || provider === 'fake');
}
