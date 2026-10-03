import type { ConnectorDefinition } from '../sdk/connector.ts';
import { demoConnector } from './demo.ts';
import { googleCalendarConnector, googleCalendarPersonalConnector } from './google-calendar.ts';

/**
 * Every connector (M6.4a). M6.4b–d append theirs here (Eventbrite, Google Sheets, Zapier, Slack,
 * Mailchimp, HubSpot, Klaviyo), in the order of decision P6-4.
 */
export const CONNECTORS: readonly ConnectorDefinition[] = [
  demoConnector,
  // M6.5c: calendar push of sessions (the org's calendar) and of personal schedules.
  googleCalendarConnector,
  googleCalendarPersonalConnector,
];

export function connectorByKey(key: string): ConnectorDefinition | null {
  return CONNECTORS.find((c) => c.key === key) ?? null;
}

/**
 * The connectors this deployment offers an org's console: fake-only ones only where the auth port
 * is the fake, and never a registrant's personal one (M6.5c; made from their schedule page).
 */
export function offeredConnectors(provider: 'nango' | 'fake' | null): ConnectorDefinition[] {
  if (!provider) return [];
  return CONNECTORS.filter(
    (c) => c.audience !== 'registrant' && (c.availability === 'general' || provider === 'fake'),
  );
}
