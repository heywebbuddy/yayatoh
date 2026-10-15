// Maestro script: makes an organizer on the e2e server (POST /api/dev/user, dev auth only): a password
// account with two-step verification ON that owns a new organization with one published event. Returns
// ${output.email}, ${output.password}, ${output.setupKey} (the authenticator's setup key, which
// scripts/totp.js turns into the current six-digit code), ${output.backupCode} and ${output.orgName}.
// The account is not signed in anywhere.
//
// Server and password: DEV_SERVER / DEV_PERSONA_PASSWORD (`maestro test -e ...`), or the same names with
// a MAESTRO_ prefix. The password is the e2e server's DEV_PERSONA_PASSWORD; it is never written in a flow.
const base =
  typeof DEV_SERVER === 'string' && DEV_SERVER
    ? DEV_SERVER
    : typeof MAESTRO_DEV_SERVER === 'string' && MAESTRO_DEV_SERVER
      ? MAESTRO_DEV_SERVER
      : 'http://localhost:3000';
const secret =
  typeof DEV_PERSONA_PASSWORD === 'string' && DEV_PERSONA_PASSWORD
    ? DEV_PERSONA_PASSWORD
    : typeof MAESTRO_DEV_PERSONA_PASSWORD === 'string'
      ? MAESTRO_DEV_PERSONA_PASSWORD
      : '';
if (!secret)
  throw new Error(
    "Set DEV_PERSONA_PASSWORD (the e2e server's value) with -e, or MAESTRO_DEV_PERSONA_PASSWORD in the environment",
  );
const response = http.post(`${base}/api/dev/user`, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'signIn=0&twoFactor=1&org=new&event=published',
});
const made = json(response.body);
output.email = made.email;
output.password = secret;
output.setupKey = made.setupKey;
output.backupCode = made.backupCodes?.length ? made.backupCodes[0] : '';
output.orgName = `Test Org ${String(made.orgSlug).replace('e2e-', '')}`;
