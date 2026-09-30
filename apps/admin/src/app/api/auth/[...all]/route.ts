import { getAuth } from '@/server/auth.ts';

// Better Auth endpoints for the staff console. Sign-up is closed: staff use existing accounts.
const closed = (req: Request) => /\/sign-up(\/|$)/.test(new URL(req.url).pathname);
export const GET = (req: Request) => getAuth().handler(req);
export const POST = (req: Request) =>
  closed(req) ? Response.json({ code: 'SIGN_UP_CLOSED' }, { status: 403 }) : getAuth().handler(req);
