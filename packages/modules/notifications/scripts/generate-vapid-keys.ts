/**
 * Print a fresh VAPID key pair (M1.10e) as environment lines. Run locally (`pnpm vapid:generate`);
 * put the output in your local env or, for production, in Doppler. Never commit the private key.
 */
import { generateVapidKeys } from '../src/web-push.ts';

const keys = generateVapidKeys();
process.stdout.write(
  `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:notifications@mail.yayatoh.com\n`,
);
