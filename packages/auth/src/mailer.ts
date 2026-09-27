/**
 * Where auth emails go. Production uses SES (M1.10, owner account pending); development
 * logs to the console; tests capture messages in memory.
 */
export interface AuthMailer {
  sendOtp(
    to: string,
    otp: string,
    purpose: 'sign-in' | 'email-verification' | 'forget-password' | string,
  ): Promise<void>;
  sendMagicLink(to: string, url: string): Promise<void>;
}

export const consoleMailer: AuthMailer = {
  async sendOtp(to, otp, purpose) {
    console.info(JSON.stringify({ mail: 'otp', to, purpose, otp, note: 'dev mailer — never in production' }));
  },
  async sendMagicLink(to, url) {
    console.info(JSON.stringify({ mail: 'magic-link', to, url, note: 'dev mailer — never in production' }));
  },
};

export function memoryMailer() {
  const sent: { to: string; kind: 'otp' | 'link'; value: string }[] = [];
  const mailer: AuthMailer = {
    async sendOtp(to, otp) {
      sent.push({ to, kind: 'otp', value: otp });
    },
    async sendMagicLink(to, url) {
      sent.push({ to, kind: 'link', value: url });
    },
  };
  return { mailer, sent };
}
