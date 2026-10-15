// Reads the newest portal sign-in email from the local Mailpit and exposes its six-digit code as
// output.code, for exhibitor-sign-in.yaml. Used only against a local or preview environment.
// Maestro runs this as plain JavaScript (no modules, no template strings guaranteed).
/* biome-ignore-all lint/style/useTemplate: Maestro's script engine */
var response = http.get(MAILPIT + '/api/v1/messages?limit=1');
var latest = json(response.body).messages[0];
var message = json(http.get(MAILPIT + '/api/v1/message/' + latest.ID).body);
var match = /\b(\d{3})\s?(\d{3})\b/.exec(message.Text);
if (!match) throw new Error('No six-digit code in the newest email');
output.code = match[1] + match[2];
