# Connector switch-on (M6.x)

Every connector runs on a fake in dev, CI and previews. Going live is per connector and per
environment; **nothing here is run by Claude Code**. Steps marked (owner) need an account or a
production setting only the owner has. Never put a key in the repo: names live in `.env.example`,
values in Doppler.

## Once, for all connectors (owner)
1. Create the Nango (Cloud) account. Set `INTEGRATIONS_AUTH_PROVIDER=nango` and `NANGO_SECRET_KEY`
   (and `NANGO_HOST` for a self-hosted Nango). The adapter's endpoints are unverified until this
   account exists: on staging, connect one connector end to end (connect, sync, disconnect) and
   confirm the connection is gone in Nango before anything else.
2. Register each provider's OAuth app (table below) as a Nango integration with the exact
   **provider config key**.
3. Billing: connectors need the `integrations` module (every plan, free in beta, P6-13) and, for
   some, a module of their own (the "Needs" column). Grant per org in admin → Entitlements.
4. Check the leak gates before the first org connects: `pnpm --filter @yayatoh/integrations test`
   (`connector-payloads.test.ts`: what leaves) and `pnpm test:int`.

## Per connector
| Connector | Nango config key | Provider-side setup (owner) | Needs | What leaves Yayatoh (documented set) |
|---|---|---|---|---|
| Eventbrite | `eventbrite` | OAuth app | `integrations` | nothing (pull only: events, ticket classes, orders) |
| Google Sheets | `google_sheets` | Google Cloud OAuth client | `integrations` | attendee name, email, labels, status |
| Google Calendar | `google_calendar`, `google_calendar_personal` | OAuth client; the calendar.events scope is "sensitive": Google verification first | `integrations` | session title, description, room, times, time zone (no attendee data) |
| Salesforce | `salesforce` | Connected app | `integrations` | contact/lead email and names, company; campaigns, members' status, sponsor opportunities |
| Slack | `slack` | Slack app (chat:write, channels:read) | `integrations` | alert and digest text only |
| Zoom | `zoom` | Marketplace app + `ZOOM_WEBHOOK_SECRET_TOKEN` | `virtual` | registrant email and names |
| Mailchimp | `mailchimp` | OAuth app | `integrations` | email, first/last name (consent first) |
| Klaviyo | `klaviyo` | OAuth app | `integrations` | email, names, company (consent first) |
| HubSpot | `hubspot` | Public app (contacts, marketing events, communication preferences) | `integrations` | contact email, names, company; marketing events; attendance email |
| QuickBooks Online, Xero | `quickbooks`, `xero` | OAuth apps | `integrations` | daily summary journals (amounts and account codes; no buyer data) |
| Zapier, Make, n8n | (webhooks + API keys) | none | `webhooks`, `api_access` | thin webhook events only |

The "documented set" is the allowlist in `packages/modules/integrations/tests/connector-payloads.test.ts`:
changing a push mapping without changing it (and this table) fails CI. A phone number, address,
payment or tax field never leaves.

## Switch on, per org (owner or org admin)
1. Entitlement on (above). 2. Org owner/admin: Integrations → Connect → consent screen.
3. Confirm the account label, the default mapping (version 1) and the first sync result.
4. Marketing connectors: check the consent rules page before the first push.

## Switch off / incident
- **One org:** disconnect in the console (syncing stops at once; the provider token is revoked at
  Nango). If Nango was unreachable the revoke may not have happened (known gap, security review
  F2): revoke the connection in the Nango dashboard by its connection id and note it in the incident.
- **One connector everywhere:** remove its entitlement in admin; or unset the Nango integration.
- **All integrations:** unset `INTEGRATIONS_AUTH_PROVIDER` (integrations read as off; stored mappings
  and links stay).
- **A leaked Nango key:** key-rotation.md, then revoke every connection from Nango's dashboard.

## Other Phase 6 switches
| Feature | Switch | Notes |
|---|---|---|
| Warehouse | `ANALYTICS_WAREHOUSE=tinybird` + `TINYBIRD_*` | default Postgres rollups; `fake` never in production |
| SSO / SCIM | `SSO_PROVIDER` + an IdP adapter | none exists yet: SSO reads as unavailable in production |
| Video | `MUX_*`, `CLOUDFLARE_STREAM_*` | per session provider choice; RTMP backup ingest |
| Agency v2 | platform flag `agency_v2` | `pnpm --filter @yayatoh/worker agency-v2` (staff) |
| Webhooks | Svix keys | fake in dev/CI |
