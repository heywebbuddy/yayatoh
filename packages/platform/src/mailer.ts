/**
 * Outbound email port (roadmap §3.1: SES v2 + React Email in M1.10). Every send carries an
 * idempotency key so a replayed event never emails twice once the SES adapter lands.
 */
export interface MailMessage {
  readonly to: string;
  /** Template key, e.g. `tenancy.invitation`; rendered by the adapter per locale. */
  readonly template: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly idempotencyKey: string;
  readonly locale?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development adapter: logs the message (dev and preview only; SES is owner-account gated). */
export const consoleMailer: Mailer = {
  async send(m) {
    console.info(JSON.stringify({ mail: m.template, to: m.to, params: m.params, key: m.idempotencyKey }));
  },
};

/** Test adapter: records messages. */
export function memoryMailer() {
  const sent: MailMessage[] = [];
  return { mailer: { send: async (m: MailMessage) => void sent.push(m) } satisfies Mailer, sent };
}
