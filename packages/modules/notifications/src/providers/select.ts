import type { Transports } from '../transports.ts';
import { providerMode, whatsappRoutes } from './config.ts';
import { fakeIdentityPort, type SendingIdentityPort, sesEmailTransport, sesIdentityPort } from './ses.ts';
import { sesWebhookAdapter } from './sns.ts';
import {
  fakeSenderStatus,
  type SenderStatusPort,
  twilioSenderStatus,
  twilioSmsTransport,
  twilioWebhookAdapter,
} from './twilio.ts';
import type { ProviderWebhookAdapter } from './types.ts';
import {
  routedWhatsAppTransport,
  whatsappCloudTransport,
  whatsappCloudWebhookAdapter,
  whatsappGatewayTransport,
  whatsappGatewayWebhookAdapter,
} from './whatsapp.ts';

/**
 * The real adapters, chosen by config names only (M3.5b). A provider is used when it is live
 * (switched on and fully configured, `providerMode`); otherwise the given fallback stays (the dev
 * mailbox in development and CI; nothing in production, where messages then wait or fall back).
 */
type Env = Readonly<Record<string, string | undefined>>;
const req = (env: Env, k: string) => env[k] ?? '';

const ses = (env: Env) => ({
  region: req(env, 'AWS_SES_REGION'),
  credentials: {
    accessKeyId: req(env, 'AWS_SES_ACCESS_KEY_ID'),
    secretAccessKey: req(env, 'AWS_SES_SECRET_ACCESS_KEY'),
    sessionToken: env.AWS_SES_SESSION_TOKEN || null,
  },
  configurationSet: req(env, 'SES_CONFIGURATION_SET'),
});

const twilio = (env: Env, origin: string) => ({
  accountSid: req(env, 'TWILIO_ACCOUNT_SID'),
  apiKeySid: req(env, 'TWILIO_API_KEY_SID'),
  apiKeySecret: req(env, 'TWILIO_API_KEY_SECRET'),
  authToken: req(env, 'TWILIO_AUTH_TOKEN'),
  messagingServiceSid: req(env, 'TWILIO_MESSAGING_SERVICE_SID'),
  callbackOrigin: origin,
});

const cloud = (env: Env) => ({
  accessToken: req(env, 'WHATSAPP_CLOUD_ACCESS_TOKEN'),
  phoneNumberId: req(env, 'WHATSAPP_CLOUD_PHONE_NUMBER_ID'),
  appSecret: req(env, 'WHATSAPP_CLOUD_APP_SECRET'),
  verifyToken: req(env, 'WHATSAPP_CLOUD_VERIFY_TOKEN'),
});

const gateway = (env: Env, origin: string) => ({
  baseUrl: req(env, 'WHATSAPP_GATEWAY_URL'),
  keyId: req(env, 'WHATSAPP_GATEWAY_KEY_ID'),
  secret: req(env, 'WHATSAPP_GATEWAY_SECRET'),
  callbackOrigin: origin,
});

/** Live providers over `base` (channel by channel). Null when nothing can send email. */
export function liveTransports(env: Env, appOrigin: string, base: Transports | null): Transports | null {
  const live = (p: Parameters<typeof providerMode>[0]) => providerMode(p, env) === 'live';
  const email = live('ses') ? sesEmailTransport(ses(env)) : base?.email;
  if (!email) return null;
  const routes = whatsappRoutes(env).filter((r) =>
    live(r === 'cloud' ? 'whatsapp_cloud' : 'whatsapp_gateway'),
  );
  const whatsapp = routes.length
    ? routedWhatsAppTransport({
        cloud: routes.includes('cloud') ? whatsappCloudTransport(cloud(env)) : null,
        gateway: routes.includes('gateway') ? whatsappGatewayTransport(gateway(env, appOrigin)) : null,
        defaultRoute: routes[0] ?? 'cloud',
      })
    : base?.whatsapp;
  const sms = live('twilio') ? twilioSmsTransport(twilio(env, appOrigin)) : base?.sms;
  return {
    email,
    ...(sms ? { sms } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(base?.push ? { push: base.push } : {}),
  };
}

export type WebhookChannel = 'email' | 'sms' | 'whatsapp';

/**
 * The verified webhook adapter behind `/api/webhooks/{channel}/{provider}`, or null (404): only
 * live providers answer. The fake email provider is handled by the caller (dev and CI).
 */
export function liveWebhookAdapter(
  channel: WebhookChannel,
  provider: string,
  env: Env,
): ProviderWebhookAdapter | null {
  if (channel === 'email' && provider === 'ses' && providerMode('ses', env) === 'live')
    return sesWebhookAdapter({
      topicArns: req(env, 'SES_SNS_TOPIC_ARN')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  if (channel === 'sms' && provider === 'twilio' && providerMode('twilio', env) === 'live')
    return twilioWebhookAdapter({ authToken: req(env, 'TWILIO_AUTH_TOKEN') });
  if (channel === 'whatsapp' && provider === 'cloud' && providerMode('whatsapp_cloud', env) === 'live')
    return whatsappCloudWebhookAdapter({ appSecret: req(env, 'WHATSAPP_CLOUD_APP_SECRET') });
  if (channel === 'whatsapp' && provider === 'gateway' && providerMode('whatsapp_gateway', env) === 'live')
    return whatsappGatewayWebhookAdapter({
      keyId: req(env, 'WHATSAPP_GATEWAY_KEY_ID'),
      secret: req(env, 'WHATSAPP_GATEWAY_SECRET'),
    });
  return null;
}

/** Meta's subscription check token, when the Cloud API is live. */
export function whatsappVerifyToken(env: Env): string | null {
  return providerMode('whatsapp_cloud', env) === 'live' ? req(env, 'WHATSAPP_CLOUD_VERIFY_TOKEN') : null;
}

const production = (env: Env) => env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';

/**
 * Sending identities: SES when live, else the fake outside production (null in production
 * without SES: the settings page says sending domains aren't available yet).
 */
export function identityPortFromEnv(env: Env): SendingIdentityPort | null {
  if (providerMode('ses', env) === 'live') return sesIdentityPort(ses(env));
  return production(env) && env.YAYATOH_DEV_AUTH !== '1' ? null : fakeIdentityPort();
}

/** 10DLC status: Twilio when live, else the fake outside production. */
export function senderStatusFromEnv(env: Env): SenderStatusPort | null {
  if (providerMode('twilio', env) === 'live') return twilioSenderStatus(twilio(env, ''));
  return production(env) && env.YAYATOH_DEV_AUTH !== '1' ? null : fakeSenderStatus();
}
