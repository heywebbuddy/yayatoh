// Maestro script: makes a throwaway account on the dev server (POST /api/dev/user, development
// only) and returns it: ${output.email}, ${output.backupCode} (when TWO_FACTOR is "1", the account
// has two-step verification on and one backup code is returned) and ${output.password}.
// The account is not signed in on any web session; the app signs in as a person would.
const base = typeof DEV_SERVER === 'string' ? DEV_SERVER : 'http://localhost:3000';
const twoFactor = typeof TWO_FACTOR === 'string' && TWO_FACTOR === '1';
const response = http.post(`${base}/api/dev/user`, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `signIn=0${twoFactor ? '&twoFactor=1' : ''}`,
});
const user = json(response.body);
output.email = user.email;
output.backupCode = user.backupCodes && user.backupCodes.length ? user.backupCodes[0] : '';
output.password = DEV_PERSONA_PASSWORD;
