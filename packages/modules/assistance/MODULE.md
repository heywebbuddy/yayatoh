# assistance (tier 5)

Guest assistance (M3.3b): guests ask for help from the seat finder with their ticket's help link;
door staff ask from the Scan PWA; one queue per event where staff take, assign, start, resolve or
cancel requests and add notes. Owns Postgres schema `assistance` (`requests`, `activity`). It
reads tickets, events, check-in devices and checkpoints, and memberships through their exported
reads only; the alert engine (tier 6) and the Command Center (tier 6) read it the same way.

**Invariants**
- **A guest request needs the ticket's help link for that event.** `<ticketId>~<hmac>` under
  APP_TOKEN_SECRET (purpose `assistance.ticket`); the ticket must be active and belong to the
  event in the URL. Another event's ticket, a forged or void one: `not_found`. At most
  `MAX_OPEN_PER_TICKET` open requests per ticket; the web action rate-limits first
  (`assistanceRequest`). The guest gets a status link (`assistance.request`) showing number,
  reason and state only.
- **Staff requests come from a device** (`checkin:device`), tied to it and to the entrance it
  scans at (a checkpoint of another event is dropped).
- **Lifecycle** (`requestLifecycle`): new → assigned → in progress → resolved | cancelled;
  starting an unassigned request assigns it to whoever starts it. Conditional updates on the
  state; every change is an `activity` row, an audit entry (never the note's text), an outbox
  event (`assistance.requested` / `assistance.updated`, ids and states) and a message on the
  event's `assistance` realtime channel (ids and states only).
- **Priority and SLA** are pure (`priorityFor`, `SLA_MS`): medical and security urgent (2 min),
  accessibility, backup and supervisor high (5 min), the rest normal (10 min). The SLA runs while
  nobody has taken the request; the alert engine raises `assistanceOverdue` when one is past it.
  Urgent and high requests are pushed at once to the staff devices at the event.
- **Assignees** are members who may work the queue at the event (`assistance:manage` by org role
  or event role), or the device asking (`me`). Viewers read the queue and can't act.
- **Privacy:** notes, locations and staff notes are `personal`; DTOs are allowlists; guests'
  names and ticket codes reach the event's staff only; nothing here feeds marketing.
