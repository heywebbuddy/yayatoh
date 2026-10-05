import { randomBytes } from 'node:crypto';

/**
 * Planted canaries that prove the leak gate fails (M5.11a). Each is assembled at run time from
 * fragments with fresh random bodies, so no real-looking secret is ever committed (the repo's
 * own gitleaks history scan stays green) and no two runs plant the same value.
 */

const alnum = (n: number, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from(randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
const upper = (n: number) => alnum(n, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');

/** A 16-digit number that passes the Luhn check (a synthetic card, never a real one). */
function luhnCard(): string {
  const body = `4${Array.from(randomBytes(14), (b) => b % 10).join('')}`;
  for (let check = 0; check <= 9; check++) {
    const d = `${body}${check}`;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    if (sum % 10 === 0) return d;
  }
  throw new Error('unreachable');
}

export interface Canary {
  readonly name: string;
  /** `secret` canaries must also trip gitleaks; `customer` canaries are ours alone. */
  readonly class: 'secret' | 'customer';
  readonly file: string;
  readonly content: string;
}

export function secretCanaries(): Canary[] {
  const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
  const pemEnd = ['-----END', 'RSA PRIVATE KEY-----'].join(' ');
  return [
    {
      name: 'github-pat',
      class: 'secret',
      file: 'canary/github.json',
      content: `${JSON.stringify({ note: 'planted', value: `${'gh'}p_${alnum(36)}` }, null, 2)}\n`,
    },
    {
      name: 'aws-access-key',
      class: 'secret',
      file: 'canary/aws.env',
      content: `AWS_ACCESS_KEY_ID=${'AK'}IA${upper(16)}\nAWS_SECRET_ACCESS_KEY=${alnum(40)}\n`,
    },
    {
      name: 'stripe-live-key',
      class: 'secret',
      file: 'canary/stripe.txt',
      content: `stripe_key = "${'sk'}_live_${alnum(32)}"\n`,
    },
    {
      name: 'private-key',
      class: 'secret',
      file: 'canary/key.pem',
      content: `${pem}\n${Array.from({ length: 12 }, () => alnum(64)).join('\n')}\n${pemEnd}\n`,
    },
  ];
}

export function customerCanaries(): Canary[] {
  return [
    {
      name: 'customer-email',
      class: 'customer',
      file: 'canary/attendees.csv',
      content: `name,email\nCanary Person,canary.${alnum(8).toLowerCase()}@gmail.com\n`,
    },
    {
      name: 'customer-ip',
      class: 'customer',
      file: 'canary/access.json',
      content: `${JSON.stringify({ at: '2026-09-29T00:00:00Z', ip: `203.0.113.${(randomBytes(1)[0] ?? 0) % 250}` }, null, 2)}\n`,
    },
    {
      name: 'customer-card',
      class: 'customer',
      file: 'canary/payment.txt',
      content: `card: ${luhnCard()}\n`,
    },
  ];
}

export const allCanaries = () => [...secretCanaries(), ...customerCanaries()];
