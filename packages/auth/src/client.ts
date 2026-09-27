import { emailOTPClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Browser client for the host the page is served from (same-origin `/api/auth`). */
export const authClient = createAuthClient({ plugins: [emailOTPClient(), twoFactorClient()] });
