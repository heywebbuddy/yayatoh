// Maestro script: makes a ticket holder who has no app account yet (POST /api/dev/leads on the
// seeded organization lakeside-events, dev auth only): a published conference under way with free
// registration, and three registrants. Returns the first registrant as ${output.holderEmail} (the
// address the ticket belongs to; signing in with an emailed code to that address creates the account)
// and ${output.holderLink} (the "My tickets" link path, /my-tickets/<token>), plus ${output.holderToken}.
// ${output.eventName} is the conference's name.
const base =
  typeof DEV_SERVER === 'string' && DEV_SERVER
    ? DEV_SERVER
    : typeof MAESTRO_DEV_SERVER === 'string' && MAESTRO_DEV_SERVER
      ? MAESTRO_DEV_SERVER
      : 'http://localhost:3000';
const name = `Maestro Expo ${Date.now().toString(36)}`;
const response = http.post(`${base}/api/dev/leads`, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `org=lakeside-events&phase=open&ready=0&name=${encodeURIComponent(name)}`,
});
const made = json(response.body);
output.holderEmail = made.people[0].email;
output.holderLink = made.myTickets;
output.holderToken = String(made.myTickets).replace('/my-tickets/', '');
output.eventName = name;
