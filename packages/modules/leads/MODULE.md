# leads (tier 6) — lead retrieval (M5.6b)

Exhibitor people capture leads by scanning badges in the Scan PWA's lead mode (`/scan/leads`).
Decisions P5-4 (licenses, capture window) and P5-8 (what a scan shares, consent).

**Invariants**
- A lead belongs to one exhibitor; every command and query acts on the signed-in portal
  principal's own exhibitor (`exhibitorPrincipalTx`, re-checked in the transaction), never an
  exhibitor id from the request. Another exhibitor's lead and a teammate's hidden lead are both
  `not_found`.
- Capture needs: a lead license within the allowance (`leadSeatStandingTx`: seats ranked oldest
  first; seats beyond a shrunken allowance are `over_allowance`), the exhibitor admin's acceptance
  of the current lead terms (`LEAD_TERMS_VERSION`), and the window: from 24 h before the event
  starts until 48 h after it ends, judged at each scan's own time (the device's unless it runs
  more than 5 min ahead). Lists, edits and export end 90 days after the event.
- Exactly once: `lead_scans` is unique per exhibitor and scan id; a repeat answers as the first
  time. The exhibitor's syncs serialize on an advisory lock. One lead per exhibitor and ticket; a
  rescan adds to it.
- A lead stores the P5-8 allowlist stamped at the first scan: name, job title, company; email only
  when the ticket holder's current `exhibitor_email_sharing` consent is granted (with its version).
  Phone and address are never read. A withdrawal clears the email (the stamp stays).
- Own vs team: the admin sees all leads; staff see the leads they scanned, or the team's when the
  admin turns on team visibility. The organizer sees no leads.
- Export: admin only, step-up (portal sign-in in the last 10 minutes), the `LeadExportRow`
  allowlist, CSV cells neutralised against formulas, times in the event's zone.

**Events:** `leads.captured@1` `{ orgId, eventId, exhibitorId, leadId, emailShared }`,
`leads.email_withdrawn@1` `{ orgId, eventId, exhibitorId, leadId }` (no consumers yet).
