import { getAuth } from '@/server/auth.ts';

// Better Auth endpoints for this host (sign-in, OTP, sessions, 2FA).
export const GET = (req: Request) => getAuth().handler(req);
export const POST = (req: Request) => getAuth().handler(req);
