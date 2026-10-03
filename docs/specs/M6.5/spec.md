# Spec: M6.5 — enterprise identity and business integrations

- **Milestone:** M6.5 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-5, P6-13)
- **Status:** M6.5a built (2026-10-03), behind the `enterprise` module key and the `IdentityProviderPort` (fake IdP, fake DNS and fake metadata in dev/CI; off in production until the owner's IdP test tenant). M6.5b–d (Salesforce, calendars, accounting) are separate increments.
- **Risk tags:** `auth`, `tenancy`, `db-migration` (owner approval needed before main)
- **Related ADRs:** 0010 (identity per host), D14 (TOTP for admins and staff)

## M6.5a — single sign-on (SAML and OIDC) and SCIM (done)

### 1. Goal and users
Enterprise organizers let their team sign in with the company's identity provider (Okta, Entra ID,
Google Workspace…), prove which email domains they own, and let the IdP add, change and remove
people automatically (SCIM). IT admins get "remove in the IdP = no access here on the next request".

### 2. References
- **P6-5:** in-house on Better Auth (SSO for SAML + OIDC, SCIM), behind `enterprise`; admins and
  staff keep TOTP (D14). **P6-13:** the `enterprise` key. **P6-1:** fakes for anything external.
- **Plan row M6.5A** acceptance: a deprovisioned SCIM user loses access on the next request; SSO
  cannot bypass TOTP for platform staff.

### 3. Scope
**In (built):**
- **Module `@yayatoh/sso`** (tier 6, schema `sso`, `MODULE.md`): `connections` (one per org; SAML
  entity id / sign-in URL / signing certificate, or OIDC issuer / client id with the client secret
  sealed by the org's key vault), `domains` (DNS TXT verification; one org per verified domain,
  platform-wide), `identities` (IdP subject ↔ account per connection), `scim_tokens` (SHA-256 at
  rest, one live per org), `scim_users`, `scim_groups` (with the mapped role), `scim_group_members`.
  All tenant tables: FORCE RLS, org-leading indexes, composite FKs; fixture rows for both orgs.
- **Settings → Single sign-on** (`/o/{org}/sso`, Settings group of the sidebar; owners and admins,
  `sso:manage`): connect SAML (paste metadata XML, a metadata URL, or the three values by hand) or
  OIDC; default role and just-in-time provisioning; our SP details to copy (entity id, ACS URL,
  redirect URI; SP metadata at `/auth/sso/saml/metadata`); **Test sign-in** (certificate/discovery
  check, then a round trip at the IdP that signs nobody in); **Turn on** only after a passed test
  with the current settings and a verified domain; **Turn off**; **Delete**. Domains: add, the TXT
  record to publish, **Check**, **Require single sign-on** per verified domain, remove. SCIM: base
  URL, token create/replace (shown once)/revoke, provisioned counts, groups with a role picker.
  Every change of who can sign in is a step-up command.
- **SSO sign-in** (`/sign-in` → "Sign in with single sign-on" → `/sign-in/sso`): the work address's
  verified domain names the org and connection (`sso.connection_for_domain`, SECURITY DEFINER); the
  browser goes to the IdP with a random state held only in its cookie (10 minutes, single use) and
  a nonce (SAML InResponseTo / OIDC nonce). Back at `/auth/sso/saml/acs` (POST) or
  `/auth/sso/callback` (GET): the answer is checked (signature, issuer, audience, request, expiry),
  the address must be in **that org's** verified domains, the account is found or created
  (an existing unverified account loses its password, 2FA and sessions first: pre-hijack guard),
  the IdP identity is linked, the person is provisioned (JIT) and the session is made by
  `/sso/session` (Better Auth, closed over HTTP). The org always comes from the pending sign-in.
- **Org-bound SSO sessions** (`auth.sessions.sso_org_id`): such a session opens that org's console
  only (console, org list, command center, realtime, seat streams, media, Scan supervisor, tenant
  account); another org asks for a new sign-in (`/sign-in?sso=other_org`).
- **Enforcement:** with "Require single sign-on" on a verified domain and the connection on,
  members with an address in it open the org only with its SSO session (owners exempt).
- **Staff and two-step verification (D14):** after the IdP, people with 2FA and **every platform
  staff member** answer their authenticator code (`platform.is_staff`, SECURITY DEFINER); staff
  without 2FA are refused; a trusted device never skips a staff member's code; the session made
  after the code keeps the org binding. The staff console has its own sessions and no SSO route.
- **SCIM 2.0** at `/api/scim/v2` (Users, Groups with GET/list `eq` filters/POST/PUT/PATCH/DELETE,
  ServiceProviderConfig, ResourceTypes; Okta/Entra quirks such as `"False"` and capitalised ops).
  Bearer token → org (`sso.scim_token_by_hash`); commands as system actor `scim:<token>`; users only
  in verified domains. Deactivate or delete → membership removed, every session and /v1 refresh
  token revoked at once. Groups map to roles (strongest wins); SSO/SCIM never make, change or
  remove an owner except removing a non-last owner on deprovisioning.
- **Fakes:** the recorded fake IdP page `/auth/sso/fake` (SAML form POST or OIDC redirect,
  HMAC-signed answers per org and connection), fake DNS (`/api/dev/sso/dns`, dev only), fake
  metadata for reserved test hosts; the SCIM client fixture is the int/e2e request sequence.

**Later / not yet:**
- The **real IdP adapter** (SAML XML signature validation, OIDC code exchange + JWKS) behind the
  same port, recorded against the owner's IdP test tenant (owner inbox). Until then production
  shows "not available yet". Better Auth's `@better-auth/sso` / `@better-auth/scim` plugins were
  read but not mounted (see Decisions).
- IdP-initiated SAML, single logout, encrypted assertions, signed AuthnRequests.
- SCIM `bulk`, sorting, ETags, other filter operators; changing a user's address (`userName` to
  another address is refused as `mutability`).
- Group roles from assertion attributes (only SCIM groups map roles).
- A per-token SCIM rate limit; SCIM audit view in the console.

### 4. Decisions (pending owner where marked)
- **Better Auth plugins not mounted (pending owner):** `@better-auth/sso` resolves DNS and fetches
  IdP endpoints itself (no port, so no fake), creates sessions outside our host binding and 2FA
  challenge, and the SCIM plugin keeps provisioning in global, non-RLS tables tied to Better Auth's
  organization plugin. We use Better Auth's sessions and internal adapter (as M1.2f social sign-in
  does) with our own ports and RLS tables; the real adapter can wrap the plugins' SAML/OIDC
  validation later.
- Only addresses in the org's verified domains (pending owner): no external contractors via SSO or
  SCIM unless their domain is verified.
- Owners are exempt from enforcement (break-glass, pending owner).
- SSO sessions are bound to their org (a person in two orgs signs in again to switch).
- Staff console TOTP is not newly required for staff without 2FA (still pending owner from M1.2).

### 5. Acceptance

| Criterion | Test |
|---|---|
| A deprovisioned SCIM user loses access on the next request (sessions revoked, no cached access) | `packages/testing/tests/sso.int.test.ts` (SCIM › deprovision); `apps/web/e2e/sso.spec.ts` (SCIM test) |
| SSO cannot bypass TOTP for platform staff; admin access still needs staff TOTP | `apps/worker/tests/sso-staff.int.test.ts` |
| An SSO assertion for org A never creates or logs into a membership in org B | `packages/testing/tests/sso.int.test.ts` (isolation); `packages/modules/sso/tests/fake.test.ts`; e2e `sso=other_org` |
| SSO setup and test sign-in; domain verification; SCIM provision/deprovision through the fake | `apps/web/e2e/sso.spec.ts` |
| Keyboard only, axe both themes, RTL | `apps/web/e2e/sso.spec.ts` |
| Permissions (viewer hidden + refused), entitlement, step-up | `sso.int.test.ts`, `sso.spec.ts` |
| SAML metadata, certificates, domains, SCIM parsing/PATCH/resources | `packages/modules/sso/tests/*.test.ts` |
