# sso (tier 6)

Single sign-on and SCIM provisioning per org (M6.5a, decision P6-5), behind the `enterprise` module
key (P6-13). Owns Postgres schema `sso`: `connections`, `domains`, `identities`, `scim_tokens`,
`scim_users`, `scim_groups` and `scim_group_members`. The identity side (global accounts, sessions)
is in `packages/auth/src/sso.ts`; memberships are written through tenancy's
`ensureManagedMembershipTx` / `removeManagedMembershipTx` (down the tiers).

**Invariants**
- **One connection per org**, SAML 2.0 or OpenID Connect, behind the `IdentityProviderPort`
  (`src/ports.ts`). Dev/CI/previews use the recorded fake IdP (`src/fake.ts`: HMAC-signed answers
  per org and connection; issuer, audience, request (InResponseTo/nonce) and expiry checked);
  production has no adapter until the owner's IdP test tenant exists (owner inbox), and SSO then
  reads as unavailable. An OIDC client secret is sealed with the org's key vault and never read
  back to a page. A connection signs people in only when `active`, which needs a passed test
  sign-in with its current settings and a verified domain; changing the IdP settings of an active
  connection puts it back to `draft`.
- **Domains** are verified with a DNS TXT record (`yayatoh-verification=<token>` at
  `_yayatoh-sso.<domain>`) through the `TxtResolver` port (fake resolver in dev/CI). One org can
  have a domain verified platform-wide (a deliberately global partial unique index); a loser gets
  `claimed_elsewhere`. **An SSO sign-in or a SCIM user may only name an address in a verified
  domain of that org**: an IdP never vouches for anyone else's address.
- **Enforcement** (a verified domain + an active connection): members with an address in the
  domain open this org's console only with a session from its IdP. Owners are exempt
  (break-glass). Disabling or deleting the connection ends enforcement.
- **Sessions from SSO are bound to their org** (`auth.sessions.sso_org_id`): they open that org's
  console only. The org comes from the pending sign-in started for it (from the email's verified
  domain), never from a header. People with two-step verification and every platform staff member
  answer their authenticator code after the IdP (D14); staff without it are refused.
- **Identity links** (`identities`): one IdP subject ↔ one account per connection; a different
  pairing is refused (`identity_conflict`).
- **Just-in-time provisioning** (`connections.jit`): a first sign-in makes the person a member with
  the role their SCIM groups map (strongest wins), else the connection's default role. SSO and SCIM
  never make anyone an owner and never change or demote an owner.
- **SCIM 2.0** at `/api/scim/v2` (Users, Groups, ServiceProviderConfig, ResourceTypes): bearer token
  `yy_scim_…` (SHA-256 at rest, shown once, one live token per org, creating a new one rotates),
  resolved through `sso.scim_token_by_hash` (the org comes from the token). Commands run as the
  system actor `scim:<token id>` (`platform:sso.scim`). Deactivating or deleting a SCIM user
  removes the membership and ends every session and /v1 refresh token of the person at once
  (no cached access: sessions are read from the database on every request). The org's last owner
  is never removed (409).
- **Group → role mapping** is set in the console (`setGroupRoleCommand`, step-up), never by the IdP.
  A member in no mapped group keeps the role they have.
- Settings changes that decide who can sign in (connection, status, enforcement, domain removal,
  SCIM token, group roles) are step-up commands with `sso:manage` (owners and admins).

**Public surface:** `.` (commands, queries, ports, fakes, SCIM helpers).
