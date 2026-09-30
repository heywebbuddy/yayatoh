import { passkeyClient } from '@better-auth/passkey/client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * Browser client for the staff console (M1.2f): password + second step as before, and passkeys
 * (sign in with one; add or remove them on the console's security page).
 */
export const staffAuthClient = createAuthClient({ plugins: [twoFactorClient(), passkeyClient()] });
