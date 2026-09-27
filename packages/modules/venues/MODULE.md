# venues (tier 1)

Org-owned venues, the platform venue directory and quote requests. Owns Postgres schema `venues`.

**Invariants**
- Venue slugs are global (public URL `yayatoh.com/venues/{slug}`), lowercase, and generated from the name (a random suffix on a clash).
- Countries are ISO 3166-1 alpha-2; latitude and longitude come as a pair or not at all; map links are `https://` only.
- Only `directory_listed`, non-archived venues of active or limited orgs are public, and only through the SECURITY DEFINER functions `venues.directory()`, `venues.public_venue(slug)` and `venues.quote_target(slug)` with allowlisted columns (`PublicVenueDto`, `DirectoryVenueDto`).
- Venues are archived, never deleted (events keep their `venue_id`); archiving unlists the venue.
- Quote requests are public (`public:venue_quote`), limited to `QUOTES_PER_HOUR` per sender key per org and per email per venue, and stored with an HMAC of the sender's network key, never the address. Reading them needs `events:write` (contact data).
- `venue.quote_requested@1` is emitted for notifications (M1.10); this module sends no email.
