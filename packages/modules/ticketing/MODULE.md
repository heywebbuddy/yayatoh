# ticketing (tier 3)

Ticket types, inventory and (from M1.5b) holds, tickets and barcodes. Owns Postgres schema `ticketing`.

**Invariants**
- Money is integer minor units in the event's currency; every price shown to a buyer is **all-in** (face + mandatory fees; billing `priceBreakdown`).
- Inventory: `quantity_sold + quantity_held ≤ quantity_total` is a CHECK constraint, so no code path can oversell.
- A ticket type belongs to one event (composite FK `(org_id, event_id)`), and its currency is the event's.
- Public reads go only through `ticketing.public_ticket_types(event_slug)` (SECURITY DEFINER, allowlisted, public + active + published events only).
- **Dates (M1.4b):** a ticket type lists the occurrences it sells for (`occurrence_ids`, empty = every date; each must be a date of its event). A ticket bought for a date carries `occurrence_id` (FK to `events.occurrences`, hand-written); check-in refuses it elsewhere (`wrong_date`). Access dates remain a separate, additional rule.

- **Bulk ticket actions (M1.8f):** `ticketing.resendTickets` (`attendees:write`) emits `ticket.resend_requested@1` per chunk; the resend mailer sends one email per active ticket to its holder with a fresh holder link (the public per-hour limit doesn't apply to organizer resends), deduplicated by `ticket-resend:{operation}:{ticket}`. `tickets.cancelled@1` (from `orders.cancelTickets`) is mailed once per ticket (`ticket-cancelled:{ticket}`). Attendee filters get ticket-type subqueries from `ticketIdsOfTypesSql` (never this schema).
