# command-center (tier 6)

The event Command Center shell (M3.2a): the widget registry, role layouts, event modes, the
readiness score and the multi-event overview. Owns Postgres schema `command_center` (`layouts`,
`mode_overrides`). It reads every other module only through their exported queries and `*Tx`
reads inside the caller's tenant transaction (reports metrics, check-in facts, seating fill,
devices, events, program, ticketing), and never writes to them. The M3.2b alert engine plugs into
the `alerts` slot with `withWidget`.

**Invariants**
- **Widgets are registered, never ad hoc.** A widget is its metadata (`WIDGET_META`: module, permission, roles, profiles, modes, size, realtime channel) plus a loader built by `defineWidget`: a tenant query whose handler resolves the caller's Command Center role for the event and refuses (`forbidden`) any widget the registry does not allow them. A key outside the registry never renders.
- **Roles are derived, never granted.** `commandCenterRole(orgRole, eventRoles)` maps members to owner, ops, finance, door or marketing (see `domain/roles.ts` for the precedence). Every loader also checks its permission through the normal query pipeline.
- **The door never sees revenue.** The sales widget is `revenue: true`: `widgetAllowed` refuses it for the door role whatever the metadata says, the default door layouts don't list it, and a saved layout can't store it.
- **Modes are computed in the event's IANA zone** (`domain/modes.ts`): pre-show from the same wall-clock time the day before the start, live from doors −2 h to the end +2 h, wrap until the end +7 calendar days; multi-date events use the current date. A manual override (`events:write`) wins until cleared; setting and clearing it is audited.
- **Layouts are per member per event**: order and hidden widgets, validated against the registry on write and filtered by role, profile, module and mode on read.
- **Realtime payloads carry no figures.** `event.metrics` gets a value-free "changed" ping from the metrics projector (the channel admits door staff); widgets re-read through their loaders. Device presence goes to `event.devices` for events in pre-show or live.
- Widget DTOs are allowlists (counts, minor units per currency, ISO times). Money is never summed across currencies.
