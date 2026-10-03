/**
 * Receiver code shown on the developer docs (M6.3b). The strings are the documentation: the unit
 * test (`examples.test.ts`) runs this exact Node example against deliveries signed by the
 * platform, so the docs cannot drift from what we send.
 */

/** Node 18+ (no dependencies). Plain JavaScript, so it runs as `.mjs` and as TypeScript. */
export const VERIFY_EXAMPLE_NODE = `import { createHmac, timingSafeEqual } from 'node:crypto';

// Your endpoint's signing secret (Settings → Webhooks → endpoint → Signing secret).
// Keep it in an environment variable, never in code.
export function verifyYayatohWebhook(secret, headers, rawBody) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (!id || !timestamp || !signatures) throw new Error('Missing webhook headers');

  // Refuse old or future messages (replay protection): 5 minutes either way.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) throw new Error('Timestamp outside tolerance');

  // Sign "<id>.<timestamp>.<raw body>" with the secret's key (base64 after "whsec_").
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(id + '.' + timestamp + '.' + rawBody).digest();

  // The header may hold several "v1,<base64>" signatures (during a secret rotation).
  const valid = signatures.split(' ').some((part) => {
    const [version, signature] = part.split(',');
    if (version !== 'v1' || !signature) return false;
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) throw new Error('Invalid signature');

  // Verified: parse the body now, and skip ids you have already handled.
  return JSON.parse(rawBody);
}
`;

/** The same check with the Standard Webhooks library (any language has one). */
export const VERIFY_EXAMPLE_LIBRARY = `// npm install standardwebhooks
import { Webhook } from 'standardwebhooks';

const wh = new Webhook(process.env.YAYATOH_WEBHOOK_SECRET.replace(/^whsec_/, ''));
// Throws on a bad signature or an old timestamp; returns the parsed message.
const message = wh.verify(rawBody, {
  'webhook-id': req.headers['webhook-id'],
  'webhook-timestamp': req.headers['webhook-timestamp'],
  'webhook-signature': req.headers['webhook-signature'],
});
`;

/** An Express receiver: read the raw body, verify, answer fast, work later. */
export const RECEIVER_EXAMPLE_EXPRESS = `import express from 'express';
import { verifyYayatohWebhook } from './verify.js';

const app = express();
// The raw body: a re-serialized JSON body would not match the signature.
app.post('/yayatoh/webhooks', express.text({ type: 'application/json' }), (req, res) => {
  let message;
  try {
    message = verifyYayatohWebhook(process.env.YAYATOH_WEBHOOK_SECRET, req.headers, req.body);
  } catch {
    return res.sendStatus(400);
  }
  queue.push(message); // Do the work after answering: reply 2xx within 15 seconds.
  res.sendStatus(204);
});
`;
