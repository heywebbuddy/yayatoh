// Maestro script: finds the claim token in the newest transfer email the e2e server "sent" to EMAIL
// (GET /api/dev/mailbox?to=..., dev auth only). Returns ${output.claimToken}. The email carries
// /claim/<token>; nothing else of the message is read.
const base =
  typeof DEV_SERVER === 'string' && DEV_SERVER
    ? DEV_SERVER
    : typeof MAESTRO_DEV_SERVER === 'string' && MAESTRO_DEV_SERVER
      ? MAESTRO_DEV_SERVER
      : 'http://localhost:3000';
const response = http.get(`${base}/api/dev/mailbox?to=${encodeURIComponent(EMAIL)}`);
const match = /\/claim\/([A-Za-z0-9_.~-]{8,})/.exec(String(response.body));
if (!match) throw new Error(`No claim link in the newest email to ${EMAIL}`);
output.claimToken = match[1];
