import { SSO_ROLES, type SsoRole } from '../schema.ts';

/** Most powerful first: when a person is in several mapped SCIM groups, the strongest role wins. */
const RANK: readonly SsoRole[] = SSO_ROLES;

export const isSsoRole = (v: unknown): v is SsoRole =>
  typeof v === 'string' && (SSO_ROLES as readonly string[]).includes(v);

/** The strongest of the mapped roles, or null when none of the person's groups is mapped. */
export function mappedRole(roles: readonly (string | null)[]): SsoRole | null {
  let best: SsoRole | null = null;
  for (const r of roles) {
    if (!isSsoRole(r)) continue;
    if (best === null || RANK.indexOf(r) < RANK.indexOf(best)) best = r;
  }
  return best;
}
