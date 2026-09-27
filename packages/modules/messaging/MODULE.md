# messaging (tier 3)

Organizer announcements and organizer↔customer conversations (M1.10c). Owns Postgres schema
`messaging`. Sends through the notifications module (the platform `Notifier` port); reads
attendees and events down the tiers.

**Invariants**
- An announcement goes to the event's active attendees, one message per email address; it is
  recorded before it is sent (the sent log) and fanned out by the worker under per-address dedupe
  keys, so a replay sends nothing twice. Staff `pause_messaging` refuses new announcements.
- One conversation per org and contact email. Every announcement and reply carries a signed link
  (HMAC of the thread id) back into that conversation; the link is the contact's only credential.
- The organizer can block a conversation (the contact's messages are refused) and report it; the
  contact can block the organizer (no more replies, and the org's event updates to that address
  stop) and report it. Reports wait for platform staff review.
- Contacts can write at most `CONTACT_HOURLY_LIMIT` messages per hour into one conversation.
- The public view of a conversation is allowlisted: no staff names, user ids or internal ids.
