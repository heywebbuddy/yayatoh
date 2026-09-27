import { type Auth, consoleMailer, createAuth } from '@yayatoh/auth';

let instance: Auth | undefined;

/** Better Auth for this host, created on first use (the build never needs the secret). */
export function getAuth(): Auth {
  if (!instance) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
    instance = createAuth({
      baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
      secret,
      // SES arrives with M1.10 (owner account pending); until then codes are logged in dev only.
      mailer: consoleMailer,
    });
  }
  return instance;
}
