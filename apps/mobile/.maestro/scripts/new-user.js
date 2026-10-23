// Maestro script: makes a throwaway account on the e2e server (POST /api/dev/user, which answers 404
// unless YAYATOH_DEV_AUTH is on; never in production) and returns it as ${output.email},
// ${output.password} and ${output.backupCode} (one backup code, only when TWO_FACTOR is "1", which
// turns two-step verification on for the account). The account is not signed in anywhere: the app
// signs in as a person would.
//
// Server and password: DEV_SERVER / DEV_PERSONA_PASSWORD (`maestro test -e ...`), or the same names
// with a MAESTRO_ prefix (Maestro reads those from the environment, which is how a CI job passes them).
// The password is the e2e server's DEV_PERSONA_PASSWORD; it is never written in a flow.
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
const twoFactor = typeof TWO_FACTOR === 'string' && TWO_FACTOR === '1';
const response = http.post(`${base}/api/dev/user`, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `signIn=0${twoFactor ? '&twoFactor=1' : ''}`,
});
const user = json(response.body);
output.email = user.email;
output.backupCode = user.backupCodes?.length ? user.backupCodes[0] : '';
output.password = secret;
