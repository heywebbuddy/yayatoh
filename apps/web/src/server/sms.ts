import 'server-only';
import { isProductionEnv } from '@yayatoh/kernel';
import { providerMode } from '@yayatoh/notifications';

/**
 * Can this deployment send text messages? Live: the Twilio account is configured (`providerMode`).
 * Local and preview: the dev mailbox takes texts too, so the SMS fields show and the "send" is
 * logged. Production without a live provider: no SMS fields at all.
 */
export const smsAvailable = (env: NodeJS.ProcessEnv = process.env): boolean =>
  providerMode('twilio', env) === 'live' || !isProductionEnv(env);
