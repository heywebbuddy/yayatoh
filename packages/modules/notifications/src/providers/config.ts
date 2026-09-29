import type { RealProvider } from './types.ts';

/**
 * Which messaging providers are switched on (M3.5b), from config names only (values live in
 * Doppler / the cloud environment, never in the repo; see `.env.example`):
 * - `EMAIL_PROVIDER=ses` sends email through SES (else the dev mailbox outside production);
 * - `SMS_PROVIDER=twilio` sends texts through Twilio;
 * - `WHATSAPP_PROVIDER=cloud`, `gateway` or `cloud,gateway` enables the WhatsApp routes; the first
 *   listed is the default route for orgs without their own (decision P3-2: Cloud API for new
 *   tenants; staff set the gateway route on orgs whose existing flows use it).
 * A provider is live only when switched on AND every one of its config names is set.
 */
export const PROVIDER_ENV: Readonly<Record<RealProvider, readonly string[]>> = {
  ses: [
    'AWS_SES_REGION',
    'AWS_SES_ACCESS_KEY_ID',
    'AWS_SES_SECRET_ACCESS_KEY',
    'SES_CONFIGURATION_SET',
    'SES_SNS_TOPIC_ARN',
  ],
  twilio: [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_API_KEY_SID',
    'TWILIO_API_KEY_SECRET',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_MESSAGING_SERVICE_SID',
  ],
  whatsapp_cloud: [
    'WHATSAPP_CLOUD_ACCESS_TOKEN',
    'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
    'WHATSAPP_CLOUD_APP_SECRET',
    'WHATSAPP_CLOUD_VERIFY_TOKEN',
  ],
  whatsapp_gateway: ['WHATSAPP_GATEWAY_URL', 'WHATSAPP_GATEWAY_KEY_ID', 'WHATSAPP_GATEWAY_SECRET'],
};

type Env = Readonly<Record<string, string | undefined>>;

export function switchedOn(provider: RealProvider, env: Env = process.env): boolean {
  if (provider === 'ses') return env.EMAIL_PROVIDER === 'ses';
  if (provider === 'twilio') return env.SMS_PROVIDER === 'twilio';
  const routes = whatsappRoutes(env);
  return routes.includes(provider === 'whatsapp_cloud' ? 'cloud' : 'gateway');
}

export function whatsappRoutes(env: Env = process.env): Array<'cloud' | 'gateway'> {
  return (env.WHATSAPP_PROVIDER ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is 'cloud' | 'gateway' => s === 'cloud' || s === 'gateway');
}

/** The config names this provider still misses (names only, never values). */
export function missingEnv(provider: RealProvider, env: Env = process.env): string[] {
  return PROVIDER_ENV[provider].filter((k) => !env[k]?.trim());
}

export type ProviderMode = 'live' | 'ready' | 'off';

/** `live`: switched on and configured; `ready`: configured, not switched on; `off`: neither. */
export function providerMode(provider: RealProvider, env: Env = process.env): ProviderMode {
  const configured = missingEnv(provider, env).length === 0;
  if (configured && switchedOn(provider, env)) return 'live';
  return configured ? 'ready' : 'off';
}

/**
 * The switch-on checklist per provider (staff console). `env` and `webhook` and `switch` items are
 * checked automatically; `owner` items are the owner's steps in the provider's console
 * (docs/owner-inbox.md, M3.5b).
 */
export interface ChecklistItem {
  readonly id: string;
  readonly check: 'owner' | 'env' | 'webhook' | 'switch';
}

export const PROVIDER_CHECKLISTS: Readonly<Record<RealProvider, readonly ChecklistItem[]>> = {
  ses: [
    { id: 'ses.production', check: 'owner' },
    { id: 'ses.domain', check: 'owner' },
    { id: 'ses.configurationSet', check: 'owner' },
    { id: 'env', check: 'env' },
    { id: 'ses.webhook', check: 'webhook' },
    { id: 'ses.switch', check: 'switch' },
  ],
  twilio: [
    { id: 'twilio.registration', check: 'owner' },
    { id: 'twilio.service', check: 'owner' },
    { id: 'env', check: 'env' },
    { id: 'twilio.webhook', check: 'webhook' },
    { id: 'twilio.switch', check: 'switch' },
  ],
  whatsapp_cloud: [
    { id: 'cloud.business', check: 'owner' },
    { id: 'cloud.templates', check: 'owner' },
    { id: 'env', check: 'env' },
    { id: 'cloud.webhook', check: 'webhook' },
    { id: 'cloud.switch', check: 'switch' },
  ],
  whatsapp_gateway: [
    { id: 'gateway.contract', check: 'owner' },
    { id: 'env', check: 'env' },
    { id: 'gateway.webhook', check: 'webhook' },
    { id: 'gateway.switch', check: 'switch' },
  ],
};
