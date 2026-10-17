// Maestro script: makes an exhibitor with a lead licence on the e2e server (POST /api/dev/leads on the
// seeded organization lakeside-events, dev auth only): a conference under way, an exhibitor whose admin
// holds a lead licence and has accepted the lead terms, and three registrants. Returns
// ${output.inviteLink} (the admin's invitation link, as the invitation email carries it),
// ${output.exhibitorEmail} (the address the code is "emailed" to), ${output.badgeCode} (the short code of
// the third registrant, Cleo, who agreed to share nothing beyond her name; the two others are already
// captured) and ${output.exhibitorName}.
const base =
  typeof DEV_SERVER === 'string' && DEV_SERVER
    ? DEV_SERVER
    : typeof MAESTRO_DEV_SERVER === 'string' && MAESTRO_DEV_SERVER
      ? MAESTRO_DEV_SERVER
      : 'http://localhost:3000';
const name = `Maestro Expo ${Date.now().toString(36)}`;
const response = http.post(`${base}/api/dev/leads`, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `org=lakeside-events&phase=open&ready=1&name=${encodeURIComponent(name)}`,
});
const made = json(response.body);
output.inviteLink = `${base}${made.admin.invite}`;
output.exhibitorEmail = made.admin.email;
output.badgeCode = made.people[2].code;
output.exhibitorName = made.exhibitor;
