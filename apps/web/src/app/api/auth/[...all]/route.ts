import { getAuth } from '@/server/auth.ts';

// Better Auth endpoints for this host (sign-in, OTP, sessions, 2FA).
// Password sign-up is closed (invite-only, M1.3): accounts start with an emailed code, which
// verifies the address, and organizations need a signup code.
const closed = (req: Request) => /\/sign-up(\/|$)/.test(new URL(req.url).pathname);
export const GET = (req: Request) => getAuth().handler(req);
export const POST = (req: Request) =>
  closed(req) ? Response.json({ code: 'SIGN_UP_CLOSED' }, { status: 403 }) : getAuth().handler(req);
