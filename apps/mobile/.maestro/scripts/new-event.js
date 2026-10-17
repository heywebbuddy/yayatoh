// Maestro script: makes a public event on the e2e server (POST /api/dev/user with org=new,
// event=published and payouts=active, dev auth only): a new organization, one published event 30 days
// out with a free pass "Free entry" and a paid pass "Supporter" (15.00), the refund page "Refunds up to
// a week before", listed on the marketplace, and a fake connected account so the fake provider can
// take the payment. Returns ${output.eventSlug}, ${output.eventName} and ${output.eventQuery}
// (the unique part of the name, for the Discover search).
const base =
  typeof DEV_SERVER === 'string' && DEV_SERVER
    ? DEV_SERVER
    : typeof MAESTRO_DEV_SERVER === 'string' && MAESTRO_DEV_SERVER
      ? MAESTRO_DEV_SERVER
      : 'http://localhost:3000';
const response = http.post(`${base}/api/dev/user`, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'signIn=0&password=0&org=new&event=published&payouts=active',
});
const made = json(response.body);
const stamp = String(made.eventSlug).replace('test-show-', '');
output.eventSlug = made.eventSlug;
output.eventQuery = stamp;
output.eventName = `Test Show ${stamp}`;
