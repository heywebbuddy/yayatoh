import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `sso` schema (roadmap §9 canary leak test). Every text, jsonb and text[]
 * column of a tenant table is listed. Nothing here is public: single sign-on and SCIM settings
 * are for the org's owners and admins, and SCIM resources go only to the org's own IdP.
 */
export const privateColumns = columnPrivacy('sso', {
  connections: {
    protocol: 'vocab',
    name: internal(),
    status: 'vocab',
    // The IdP's entity id, sign-in URL, certificate (public key) or issuer and client id.
    idp_config: internal(),
    client_secret_sealed: secret('sealed'),
    default_role: 'vocab',
    last_test_reason: internal(),
  },
  domains: {
    domain: internal('none', {
      why: 'a DNS name under a CHECK; only owners and admins see it on the SSO settings page',
    }),
    status: 'vocab',
    // Published in the org's DNS on purpose, but never shown outside the settings page.
    token: internal(),
    failure_reason: internal(),
  },
  identities: { subject: personal() },
  scim_tokens: { prefix: secret('key-prefix'), token_hash: secret() },
  scim_users: {
    user_name: personal('email'),
    external_id: internal(),
    display_name: personal(),
    given_name: personal(),
    family_name: personal(),
  },
  scim_groups: { display_name: internal(), external_id: internal(), role: 'vocab' },
  scim_group_members: {},
});
