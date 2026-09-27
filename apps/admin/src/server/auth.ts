import 'server-only';
import { type Auth, consoleMailer, createAuth } from '@yayatoh/auth';

let instance: Auth | undefined;

/**
 * Better Auth for the staff console (admin.yayatoh.com): its own session cookie, so a web
 * session never signs anyone in here. Staff still need an entry in `platform.staff`.
 */
export function getAuth(): Auth {
  if (!instance) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
    instance = createAuth({
      baseURL: process.env.ADMIN_AUTH_URL ?? 'http://localhost:3001',
      secret,
      mailer: consoleMailer,
      cookieNamespace: 'admin',
    });
  }
  return instance;
}
