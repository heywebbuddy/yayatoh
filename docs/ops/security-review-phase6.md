# Phase 6 security review: OAuth tokens, SSO and SCIM (M6.x)

Scope: the `IntegrationAuth` port and its Nango adapter, the connect/callback flow, connector
traffic and what is stored or logged; SSO (SAML ACS, OIDC callback), SCIM, session binding. Method:
code review of the merged Phase 6 code plus tests; all adapters except the fakes are unverified until
the owner's accounts exist (owner inbox). Written in general terms on purpose (the repo is public).

## Fixed in M6.x
| # | Finding | Fix | Test |
|---|---|---|---|
| F3 | A Slack `no_permission` answer (one channel the app may not post to) was treated like a dead token and revoked the whole connection | Only token-level errors (`invalid_auth`, `token_revoked`, `account_inactive`, …) are auth failures | `integrations/tests/slack.test.ts` |
| H1 | A connector-built provider path was only checked for a leading `/`; a path with `..`, an encoded `..`, `?` or `#` could leave the proxy prefix and reach the auth service's own API | `providerPath` allowlist in the Nango adapter; refused with `bad_path` before any request | `integrations/tests/auth.test.ts` |

## Open (decision or design needed)
| # | Severity | Finding | Proposed fix |
|---|---|---|---|
| F1 | Medium | Zoom webinar ids are only unique per org (RLS hides other orgs), and linking one needs `events:write` and a number. Two orgs linking the same id make the join/leave webhook resolve to no org (attendance dropped); an org that links an id first can receive another's attendance | Accept a link only for an id listed by the org's own Zoom connection, or make the id globally unique with a SECURITY DEFINER pre-check. Changes the linking flow: owner call |
| F2 | Medium | Disconnect marks the connection revoked, then revokes at the provider; if the provider call fails the error is swallowed, the token may stay live there, and nothing retries | Queue the revoke as a retried job with an audit row and an alert; runbook step meanwhile (connectors.md) |

## Hardening, not exploitable today
- Provider-returned ids (record ids) are interpolated into some connector paths unencoded; H1 now contains the blast radius, `encodeURIComponent` per connector is the follow-up.
- The fake SSO runtime is switched off only by the Vercel production flag; also refuse it when `NODE_ENV=production` without dev auth.
- The pending SSO sign-in is read, then deleted (not atomic): use delete-returning.
- The IdP port contract does not yet say that a real adapter must check OIDC `email_verified`, SAML conditions (audience, recipient, `NotOnOrAfter`) on the signed element, signature-wrapping defence, and normalise the email. Add to `ports.ts` before the first adapter.
- A verified domain stays verified if its DNS record later disappears: schedule a re-check.
- SCIM bearer authentication has no per-IP limit (256-bit tokens make guessing infeasible).

## Checked, no finding
- OAuth tokens never reach Yayatoh: the port keeps them, error bodies are dropped (status and a short code only), run and error rows hold codes, `redactSecrets` guards free text; the fake's tokens are leak canaries the crawl looks for.
- The connect state is random, stored hashed, expiring, single use, and looked up under the org's RLS; the callback needs a signed-in member with `integrations:manage`; the auth reference is checked against the org.
- SSO: state bound to the browser cookie and single use; the org comes only from the server-side pending record; session bound to the org (`sso_org_id`); SSO and SCIM never grant owner; domain checks run in the precheck and again in the command; deprovisioning ends sessions; SCIM tokens hashed, rotated, mapped to the org by token alone.
- Webhook verification (Zoom): HMAC on the raw body, timing-safe, timestamp window, deduplicated.
