/**
 * The native sign-in sheets (M7.1c), behind two small ports so the sign-in logic is tested without a
 * phone. The Expo adapters are the only code that touches `expo-apple-authentication`,
 * `expo-auth-session` and `expo-web-browser`.
 *
 * Nonce rules (packages/auth/src/id-token.ts): the app makes a random nonce per attempt and sends it
 * to `/v1/auth/token` with the id_token. Apple's sheet is given the SHA-256 (hex) of it and puts that
 * in the token; for Google the nonce goes into the authorization request as given and comes back as
 * the token's `nonce` claim.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { RandomBytes } from '../ports';

export interface IdTokenResult {
  readonly idToken: string;
  /** Apple gives a name on the very first sign-in only, and not inside the token. */
  readonly name?: string;
}

export interface AppleSignInProvider {
  isAvailable(): Promise<boolean>;
  /** Shows the sheet with `hashedNonce`; null when the person cancelled. */
  signIn(hashedNonce: string): Promise<IdTokenResult | null>;
}

export interface GoogleSignInProvider {
  /** Shows Google's sign-in with `nonce`; null when the person cancelled. */
  signIn(nonce: string): Promise<IdTokenResult | null>;
}

/** 32 random bytes as 64 hex characters: well above the server's 16-character minimum. */
export function makeNonce(random: RandomBytes): string {
  return bytesToHex(random(32));
}

export const hashNonce = (nonce: string): string => bytesToHex(sha256(new TextEncoder().encode(nonce)));

export function expoAppleProvider(): AppleSignInProvider {
  return {
    isAvailable: () => AppleAuthentication.isAvailableAsync(),
    async signIn(hashedNonce) {
      try {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashedNonce,
        });
        if (!credential.identityToken) return null;
        const name = credential.fullName
          ? AppleAuthentication.formatFullName(credential.fullName).trim()
          : '';
        return { idToken: credential.identityToken, ...(name ? { name } : {}) };
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
        throw err;
      }
    },
  };
}

export interface GoogleProviderOptions {
  /** The OAuth client id for this platform (iOS or Android client type). */
  readonly clientId: string;
  /** The redirect the client type allows, e.g. `com.googleusercontent.apps.<id>:/oauthredirect`. */
  readonly redirectUri: string;
}

const GOOGLE_ISSUER = 'https://accounts.google.com';

/**
 * Google through the system browser session with PKCE (`expo-auth-session`): the one maintained
 * route that lets the app set the nonce, which the server requires. The free native Google Sign-In
 * library has no nonce option, so its id_token would be refused.
 */
export function expoGoogleProvider(options: GoogleProviderOptions): GoogleSignInProvider {
  return {
    async signIn(nonce) {
      WebBrowser.maybeCompleteAuthSession();
      const discovery = await AuthSession.fetchDiscoveryAsync(GOOGLE_ISSUER);
      const request = new AuthSession.AuthRequest({
        clientId: options.clientId,
        redirectUri: options.redirectUri,
        scopes: ['openid', 'email', 'profile'],
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
        extraParams: { nonce },
      });
      const result = await request.promptAsync(discovery);
      if (result.type !== 'success') return null;
      const tokens = await AuthSession.exchangeCodeAsync(
        {
          clientId: options.clientId,
          code: result.params.code ?? '',
          redirectUri: options.redirectUri,
          extraParams: { code_verifier: request.codeVerifier ?? '' },
        },
        discovery,
      );
      return tokens.idToken ? { idToken: tokens.idToken } : null;
    },
  };
}
