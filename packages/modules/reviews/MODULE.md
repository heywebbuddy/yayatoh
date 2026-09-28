# reviews (tier 5)

Event reviews by ticket holders (M1.4g). Owns Postgres schema `reviews`.

**Tier:** 5. Eligibility reads the buyer's order and tickets (`orders`, tier 4, which composes
`ticketing` and `events`) inside the review's own tenant transaction; nothing below needs
reviews. The composite FKs point down: `reviews → events.events` (tier 2) and
`reviews → orders.orders` (tier 4).

**Invariants**
- Only a buyer who **still holds a live ticket** may review, from their order page (the manage
  link token is re-verified under the org's RLS), once their ticket's date has **ended** (an
  instant; a multi-date ticket uses its own date), for an event that took place (not cancelled
  or postponed), until the end of the local day 90 days later in the event's timezone.
  Check-in is not required (pending owner).
- **One review per holder per event**: `UNIQUE (org_id, event_id, author_key)`, where
  `author_key` = SHA-256(org id ∶ normalized buyer email). The email is never stored here; the
  public name is "First L." (`reviewerDisplayName`).
- Rating 1–5; optional plain text ≤ 1000 characters (control and bidi-override characters
  stripped; rendered as text, never Markdown or HTML).
- The public sees only `visible` reviews, through `PublicReviewDto` (rating, text, "First L.",
  date, and an id to report it). JSON-LD `aggregateRating` only from `MIN_REVIEWS_FOR_RATING`
  (3, pending owner) visible reviews.
- Moderation (`events:write`, event roles included): hide/unhide with a reason, dismiss reports.
  Each is audited with the reason. Viewers read the list only. Reports are one per device per
  review; hiding marks open reports `actioned`.
- Events: `review.submitted@1`, `review.hidden@1`, `review.unhidden@1`, `review.reported@1`.
- Submissions and reports are rate-limited by the caller (M1.14 policies `reviewSubmit`,
  `reviewReport`).
