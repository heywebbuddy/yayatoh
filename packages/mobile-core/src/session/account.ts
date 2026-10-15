/**
 * The signed-in person's account commands (M7.3a): sign out of every device, and delete the account
 * (App Store rule 5.1.1(v)). Like the sign-in helpers, each returns a plain outcome for the screen
 * to switch on and never throws for something that went the way the server meant.
 *
 * - **Sign out everywhere** asks the server to end every session and revoke every refresh token,
 *   then ends this phone's session (which wipes its tokens and cache). If the server cannot be
 *   reached nothing is changed and the person is told, instead of pretending.
 * - **Delete account** needs a fresh step-up (`SignIn.stepUp`, which the screen asks for first).
 *   Once the server has deleted the account this phone signs out the same way, so it holds no
 *   tokens and no cached server data.
 */
import type { YayatohClient } from '@yayatoh/sdk';
import { readProblem } from '../problem';
import type { SessionStore } from './session-store';

export type SignOutEverywhereOutcome = { readonly kind: 'done' } | { readonly kind: 'unavailable' };

export type DeleteAccountOutcome =
  | { readonly kind: 'deleted' }
  /** The step-up is older than ten minutes: confirm again, then retry. Nothing was deleted. */
  | { readonly kind: 'stepUpRequired' }
  /** The person is the only owner of these organizations: they must hand them over first. */
  | { readonly kind: 'lastOwner'; readonly organizations: readonly string[] }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number | null }
  /** Offline, a timeout or a 5xx: nothing is known to have been deleted. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' };

export interface AccountDeps {
  /** The signed-in client. */
  readonly api: YayatohClient;
  readonly session: SessionStore;
}

export function createAccount(deps: AccountDeps) {
  return {
    async signOutEverywhere(): Promise<SignOutEverywhereOutcome> {
      let status = 0;
      try {
        status = (await deps.api.POST('/v1/auth/sign-out-everywhere')).response.status;
      } catch {
        status = 0;
      }
      // 204: every session and refresh token is gone. 401: this one already was.
      if (status === 204 || status === 401) {
        await deps.session.signOut();
        return { kind: 'done' };
      }
      return { kind: 'unavailable' };
    },

    async deleteAccount(): Promise<DeleteAccountOutcome> {
      let result: Awaited<ReturnType<YayatohClient['DELETE']>>;
      try {
        result = await deps.api.DELETE('/v1/me');
      } catch {
        return { kind: 'unavailable' };
      }
      const { error, response } = result as { error?: unknown; response: Response };
      if (response.ok) {
        await deps.session.signOut();
        return { kind: 'deleted' };
      }
      const p = readProblem(error, response.status);
      if (p.code === 'step_up_required') return { kind: 'stepUpRequired' };
      if (response.status === 409 && p.reason === 'last_owner') {
        const orgs = Array.isArray(p.details.orgs) ? p.details.orgs.map(String) : [];
        return { kind: 'lastOwner', organizations: orgs };
      }
      if (response.status === 429 || p.code === 'rate_limited') {
        const header = Number(response.headers.get('retry-after'));
        const detail = Number(p.details.retryAfter);
        const wait = header > 0 ? header : detail > 0 ? detail : null;
        return { kind: 'rateLimited', retryAfterSeconds: wait };
      }
      return response.status >= 500 || response.status === 0 ? { kind: 'unavailable' } : { kind: 'failed' };
    },
  };
}

export type Account = ReturnType<typeof createAccount>;
