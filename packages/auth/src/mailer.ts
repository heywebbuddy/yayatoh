import { isProductionEnv } from '@yayatoh/kernel';

/**
 * Where auth emails go. Production hosts send through the live email provider (the web app's
 * `authMailer`); development logs to the console; tests capture messages in memory.
 */
export interface AuthMailer {
  sendOtp(
    to: string,
    otp: string,
    purpose: 'sign-in' | 'email-verification' | 'forget-password' | string,
  ): Promise<void>;
  sendMagicLink(to: string, url: string): Promise<void>;
  /** "Forgot your password?" (M1.2f): a link to choose a new one (30 minutes, single use). */
  sendPasswordReset?(to: string, url: string): Promise<void>;
}

/**
 * In production the console mailer refuses: a sign-in code or link written to a log would let
 * anyone who reads the logs sign in. Production hosts pass a real mailer.
 */
function refuseInProduction(mail: string): void {
  if (isProductionEnv()) {
    console.error(JSON.stringify({ mail, error: 'not sent: no email provider for auth mail in production' }));
    throw new Error('Auth email is not configured in production');
  }
}

export const consoleMailer: AuthMailer = {
  async sendOtp(to, otp, purpose) {
    refuseInProduction('otp');
    console.info(JSON.stringify({ mail: 'otp', to, purpose, otp, note: 'dev mailer — never in production' }));
  },
  async sendMagicLink(to, url) {
    refuseInProduction('magic-link');
    console.info(JSON.stringify({ mail: 'magic-link', to, url, note: 'dev mailer — never in production' }));
  },
  async sendPasswordReset(to, url) {
    refuseInProduction('password-reset');
    console.info(
      JSON.stringify({ mail: 'password-reset', to, url, note: 'dev mailer — never in production' }),
    );
  },
};

export function memoryMailer() {
  const sent: { to: string; kind: 'otp' | 'link' | 'reset'; value: string }[] = [];
  const mailer: AuthMailer = {
    async sendOtp(to, otp) {
      sent.push({ to, kind: 'otp', value: otp });
    },
    async sendMagicLink(to, url) {
      sent.push({ to, kind: 'link', value: url });
    },
    async sendPasswordReset(to, url) {
      sent.push({ to, kind: 'reset', value: url });
    },
  };
  return { mailer, sent };
}
