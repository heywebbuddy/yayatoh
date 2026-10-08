# Yayatoh panel and endpoint inventory

Each entry lists a source route, its local server dependencies, and domain operations detected through imports. Paths include the locale placeholder where present. Import connections are static evidence, not proof that every imported operation executes on this route.

## admin API

### admin /api-usage

- Type: page.
- Source: [apps/admin/src/app/api-usage/page.tsx](../../apps/admin/src/app/api-usage/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [tenants.ts](../../apps/admin/src/server/tenants.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /api/auth/[...all]

- Type: endpoint.
- Source: [apps/admin/src/app/api/auth/[...all]/route.ts](../../apps/admin/src/app/api/auth/[...all]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/platform.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### admin /api/csp-report

- Type: endpoint (POST).
- Source: [apps/admin/src/app/api/csp-report/route.ts](../../apps/admin/src/app/api/csp-report/route.ts).
- Direct domain imports: @yayatoh/platform, @yayatoh/platform/security.
- Connected packages: @yayatoh/platform, @yayatoh/platform/security.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### admin /api/health

- Type: endpoint (GET).
- Source: [apps/admin/src/app/api/health/route.ts](../../apps/admin/src/app/api/health/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: none detected.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

## development

### web /[locale]/dev/design

- Type: page.
- Source: [apps/web/src/app/[locale]/dev/design/page.tsx](../../apps/web/src/app/[locale]/dev/design/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/dev/integrations/authorize

- Type: page.
- Source: [apps/web/src/app/[locale]/dev/integrations/authorize/page.tsx](../../apps/web/src/app/[locale]/dev/integrations/authorize/page.tsx).
- Direct domain imports: @yayatoh/integrations, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/dev/login

- Type: page.
- Source: [apps/web/src/app/[locale]/dev/login/page.tsx](../../apps/web/src/app/[locale]/dev/login/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/dev/mailbox

- Type: page.
- Source: [apps/web/src/app/[locale]/dev/mailbox/page.tsx](../../apps/web/src/app/[locale]/dev/mailbox/page.tsx).
- Direct domain imports: @yayatoh/notifications, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /api/dev/accounting/fixture

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/accounting/fixture/route.ts](../../apps/web/src/app/api/dev/accounting/fixture/route.ts).
- Direct domain imports: @yayatoh/db, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: fixtureCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/ai-credits

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/ai-credits/route.ts](../../apps/web/src/app/api/dev/ai-credits/route.ts).
- Direct domain imports: @yayatoh/ai, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/ai, @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: adjustCreditsCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/analytics/backfill

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/analytics/backfill/route.ts](../../apps/web/src/app/api/dev/analytics/backfill/route.ts).
- Direct domain imports: @yayatoh/analytics, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: backfillStatusQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/analytics/run

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/analytics/run/route.ts](../../apps/web/src/app/api/dev/analytics/run/route.ts).
- Direct domain imports: @yayatoh/analytics, @yayatoh/db, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/alerts, @yayatoh/analytics, @yayatoh/attendees, @yayatoh/auth, @yayatoh/automations, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/ce, @yayatoh/checkin, @yayatoh/cms, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/forms, @yayatoh/guests, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/leads, @yayatoh/messaging, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [conference-sources.ts](../../apps/web/src/server/conference-sources.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [delivery-webhooks.ts](../../apps/web/src/server/delivery-webhooks.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [notifications.ts](../../apps/web/src/server/notifications.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: listReportSchedulesQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/billing

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/billing/route.ts](../../apps/web/src/app/api/dev/billing/route.ts).
- Direct domain imports: @yayatoh/billing, @yayatoh/checkin, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [billing.ts](../../apps/web/src/server/billing.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: enrollDeviceCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/campaigns/run

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/campaigns/run/route.ts](../../apps/web/src/app/api/dev/campaigns/run/route.ts).
- Direct domain imports: @yayatoh/campaigns, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/campaigns, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/ce

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/ce/route.ts](../../apps/web/src/app/api/dev/ce/route.ts).
- Direct domain imports: @yayatoh/checkin, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/virtual.
- Connected packages: @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createCheckpointCommand, createEventCommand, createSessionCommand, createStreamCommand, heartbeatCommand, registrationSetupQuery, scanTicketCommand, seedRegistrationDefaultsCommand, setCellCommand, setEventDetailsCommand, setSessionAgendaCommand, setTicketAccessCommand, startPlaybackCommand, startRegistrationCommand, transitionEventCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/charity

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/charity/route.ts](../../apps/web/src/app/api/dev/charity/route.ts).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/donations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: charityProfileQuery, verifyCharityCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/conference-hub

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/conference-hub/route.ts](../../apps/web/src/app/api/dev/conference-hub/route.ts).
- Direct domain imports: @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createEventCommand, createSessionCommand, enableLiveCommand, registrationSetupQuery, seedRegistrationDefaultsCommand, setCellCommand, setSessionAgendaCommand, startRegistrationCommand, transitionEventCommand, updateNetworkSettingsCommand, updateSessionCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/conference

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/conference/route.ts](../../apps/web/src/app/api/dev/conference/route.ts).
- Direct domain imports: @yayatoh/alerts, @yayatoh/db, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/alerts, @yayatoh/attendees, @yayatoh/auth, @yayatoh/automations, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/ce, @yayatoh/checkin, @yayatoh/cms, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/forms, @yayatoh/guests, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/leads, @yayatoh/messaging, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [conference-sources.ts](../../apps/web/src/server/conference-sources.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [delivery-webhooks.ts](../../apps/web/src/server/delivery-webhooks.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [notifications.ts](../../apps/web/src/server/notifications.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/disputes/alerts

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/disputes/alerts/route.ts](../../apps/web/src/app/api/dev/disputes/alerts/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/payments, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: alertDisputeDeadlinesCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/donations/collect

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/donations/collect/route.ts](../../apps/web/src/app/api/dev/donations/collect/route.ts).
- Direct domain imports: @yayatoh/donations, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/donations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/donations/provider

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/donations/provider/route.ts](../../apps/web/src/app/api/dev/donations/provider/route.ts).
- Direct domain imports: @yayatoh/db, @yayatoh/kernel, @yayatoh/payments, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/engagement

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/engagement/route.ts](../../apps/web/src/app/api/dev/engagement/route.ts).
- Direct domain imports: @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/program, @yayatoh/registration, @yayatoh/surveys, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/surveys, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createEventCommand, createPollCommand, createSessionCommand, createSurveyCommand, enableLiveCommand, openPollCommand, registrationSetupQuery, seedRegistrationDefaultsCommand, setCellCommand, startRegistrationCommand, transitionEventCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/enrollment

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/enrollment/route.ts](../../apps/web/src/app/api/dev/enrollment/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createEventCommand, createSessionCommand, createSessionGroupCommand, enrollSessionCommand, myScheduleQuery, registrationSetupQuery, seedRegistrationDefaultsCommand, setCellCommand, setSessionAgendaCommand, startRegistrationCommand, transitionEventCommand, updateSessionCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/guest-code

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/guest-code/route.ts](../../apps/web/src/app/api/dev/guest-code/route.ts).
- Direct domain imports: @yayatoh/orders.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/integrations/authorize

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/integrations/authorize/route.ts](../../apps/web/src/app/api/dev/integrations/authorize/route.ts).
- Direct domain imports: @yayatoh/integrations.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/integrations/fake

- Type: endpoint (GET, POST).
- Source: [apps/web/src/app/api/dev/integrations/fake/route.ts](../../apps/web/src/app/api/dev/integrations/fake/route.ts).
- Direct domain imports: @yayatoh/integrations.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/integrations/load

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/integrations/load/route.ts](../../apps/web/src/app/api/dev/integrations/load/route.ts).
- Direct domain imports: @yayatoh/integrations, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: beginConnectCommand, completeConnectCommand, connectionDetailQuery, disconnectCommand, listConnectionsQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/integrations/run

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/integrations/run/route.ts](../../apps/web/src/app/api/dev/integrations/run/route.ts).
- Direct domain imports: @yayatoh/integrations, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/last-code

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/dev/last-code/route.ts](../../apps/web/src/app/api/dev/last-code/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/last-link

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/dev/last-link/route.ts](../../apps/web/src/app/api/dev/last-link/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/leads

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/leads/route.ts](../../apps/web/src/app/api/dev/leads/route.ts).
- Direct domain imports: @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/orders, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ticketing.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ticketing.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: acceptLeadTermsCommand, createEventCommand, createExhibitorCommand, inviteExhibitorMemberCommand, portalAssignLeadLicenseCommand, registrationSetupQuery, saveLeadLicenseSettingsCommand, seedRegistrationDefaultsCommand, setCellCommand, startRegistrationCommand, syncLeadScansCommand, transitionEventCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/login

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/login/route.ts](../../apps/web/src/app/api/dev/login/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev-sign-in.ts](../../apps/web/src/server/dev-sign-in.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /api/dev/mailbox/[id]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/dev/mailbox/[id]/route.ts](../../apps/web/src/app/api/dev/mailbox/[id]/route.ts).
- Direct domain imports: @yayatoh/notifications.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/mailbox

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/dev/mailbox/route.ts](../../apps/web/src/app/api/dev/mailbox/route.ts).
- Direct domain imports: @yayatoh/notifications.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/mass-refunds/run

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/mass-refunds/run/route.ts](../../apps/web/src/app/api/dev/mass-refunds/run/route.ts).
- Direct domain imports: @yayatoh/orders, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/messaging

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/messaging/route.ts](../../apps/web/src/app/api/dev/messaging/route.ts).
- Direct domain imports: @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: setQuotaLimitCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/outbox/drain

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/outbox/drain/route.ts](../../apps/web/src/app/api/dev/outbox/drain/route.ts).
- Direct domain imports: @yayatoh/tenancy.
- Connected packages: @yayatoh/alerts, @yayatoh/attendees, @yayatoh/auth, @yayatoh/automations, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/ce, @yayatoh/checkin, @yayatoh/cms, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/forms, @yayatoh/guests, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/leads, @yayatoh/messaging, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [conference-sources.ts](../../apps/web/src/server/conference-sources.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [delivery-webhooks.ts](../../apps/web/src/server/delivery-webhooks.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [notifications.ts](../../apps/web/src/server/notifications.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/payments/reconcile

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/payments/reconcile/route.ts](../../apps/web/src/app/api/dev/payments/reconcile/route.ts).
- Direct domain imports: @yayatoh/payments, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/payments/settle

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/payments/settle/route.ts](../../apps/web/src/app/api/dev/payments/settle/route.ts).
- Direct domain imports: @yayatoh/payments, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/printers

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/printers/route.ts](../../apps/web/src/app/api/dev/printers/route.ts).
- Direct domain imports: @yayatoh/badges, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/badges, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: setPrintNodeCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/push-service/[id]

- Type: endpoint (GET, POST).
- Source: [apps/web/src/app/api/dev/push-service/[id]/route.ts](../../apps/web/src/app/api/dev/push-service/[id]/route.ts).
- Direct domain imports: @yayatoh/notifications.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: verifyVapidAuthorization.

### web /api/dev/search/run

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/search/run/route.ts](../../apps/web/src/app/api/dev/search/run/route.ts).
- Direct domain imports: @yayatoh/marketplace, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [search.ts](../../apps/web/src/server/search.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/seat-finder-code

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/dev/seat-finder-code/route.ts](../../apps/web/src/app/api/dev/seat-finder-code/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/seating.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/seat-streams

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/seat-streams/route.ts](../../apps/web/src/app/api/dev/seat-streams/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/seating-sections

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/seating-sections/route.ts](../../apps/web/src/app/api/dev/seating-sections/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/seating.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: eventSeatingQuery, setEventLayoutCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/seating-solver

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/seating-solver/route.ts](../../apps/web/src/app/api/dev/seating-solver/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/seating, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addPartyGuestCommand, createPartyCommand, getEventBySlugQuery, setEventLayoutCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/session-checkin

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/session-checkin/route.ts](../../apps/web/src/app/api/dev/session-checkin/route.ts).
- Direct domain imports: @yayatoh/checkin, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createCheckpointCommand, createEventCommand, createRoomCommand, createSessionCommand, enrollSessionCommand, myScheduleQuery, registrationSetupQuery, seedRegistrationDefaultsCommand, sessionAttendanceQuery, setCellCommand, setItemSessionsCommand, setSessionAgendaCommand, startRegistrationCommand, transitionEventCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/session/age

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/session/age/route.ts](../../apps/web/src/app/api/dev/session/age/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/sso/dns

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/sso/dns/route.ts](../../apps/web/src/app/api/dev/sso/dns/route.ts).
- Direct domain imports: @yayatoh/sso.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/status-incident

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/status-incident/route.ts](../../apps/web/src/app/api/dev/status-incident/route.ts).
- Direct domain imports: @yayatoh/platform.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/user

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/user/route.ts](../../apps/web/src/app/api/dev/user/route.ts).
- Direct domain imports: @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/payments, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ticketing.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ticketing.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev-sign-in.ts](../../apps/web/src/server/dev-sign-in.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: acceptAgreementCommand, addMemberCommand, applyAccountEventCommand, createEventCommand, createTicketTypeCommand, recordPayoutAccountCommand, saveTemplateCommand, setEntitlementOverrideCommand, setLegalPageCommand, transitionEventCommand, updateSiteSettingsCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/video/[playback]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/dev/video/[playback]/route.ts](../../apps/web/src/app/api/dev/video/[playback]/route.ts).
- Direct domain imports: @yayatoh/virtual.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/virtual

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/virtual/route.ts](../../apps/web/src/app/api/dev/virtual/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/virtual.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [virtual.ts](../../apps/web/src/server/virtual.ts).
- Operations in local dependency chain: createEventCommand, createSessionCommand, registrationSetupQuery, seedRegistrationDefaultsCommand, setCellCommand, startRegistrationCommand, transitionEventCommand, virtualSetupQuery, watchableTicketsQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/waitlist/sweep

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/waitlist/sweep/route.ts](../../apps/web/src/app/api/dev/waitlist/sweep/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: sweepWaitlistsCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/webhooks/drain

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/webhooks/drain/route.ts](../../apps/web/src/app/api/dev/webhooks/drain/route.ts).
- Direct domain imports: @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/webhooks.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [webhooks-dev.ts](../../apps/web/src/server/webhooks-dev.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/dev/zoom

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/dev/zoom/route.ts](../../apps/web/src/app/api/dev/zoom/route.ts).
- Direct domain imports: @yayatoh/integrations, @yayatoh/virtual.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

## event console

### web /[locale]/o/[org]/e/[event]/[section]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/[section]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/[section]/page.tsx).
- Direct domain imports: @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEventBase, notFound.

### web /[locale]/o/[org]/e/[event]/access

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/access/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/access/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createAccessCodeCommand, eventDetailsQuery, getEventBySlugQuery, getOrganizationQuery, listAccessCodesQuery, listMediaQuery, listTicketTypesQuery, privateInfoQuery, setAccessCodeActiveCommand, setPrivateInfoCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/analysis/bookings/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/analysis/bookings/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/analysis/bookings/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: bookingsExportBulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/analysis/bookings

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/analysis/bookings/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/analysis/bookings/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/reports, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: bookingSearchQuery, bookingsExportBulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/analysis/finance

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/analysis/finance/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/analysis/finance/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: eventFinanceQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/analysis

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/analysis/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/analysis/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: eventReportQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/assistance

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/assistance/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/assistance/page.tsx).
- Direct domain imports: @yayatoh/assistance, @yayatoh/auth, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addNoteCommand, assignCommand, assigneesQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, queueQuery, teamEventBySlugQuery, updateCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/attendees/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/attendees/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/attendees/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: attendeeExportBulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/attendees/import/[batch]/failures

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/attendees/import/[batch]/failures/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/attendees/import/[batch]/failures/route.ts).
- Direct domain imports: @yayatoh/attendees, @yayatoh/kernel.
- Connected packages: @yayatoh/attendees, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, importFailuresQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/attendees/import

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/attendees/import/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/attendees/import/page.tsx).
- Direct domain imports: @yayatoh/attendees, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: attendeeImportBulk, getEventBySlugQuery, getOrganizationQuery, importSummaryQuery, listMediaQuery, stageImportCommand, teamEventBySlugQuery, validateImportCommand.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/attendees

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/attendees/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/attendees/page.tsx).
- Direct domain imports: @yayatoh/attendees, @yayatoh/badges, @yayatoh/crm, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/reports, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/badges, @yayatoh/badges/client, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/crm/client, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badges.ts](../../apps/web/src/server/badges.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [demo.ts](../../apps/web/src/server/demo.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [printing-actions.ts](../../apps/web/src/server/printing-actions.ts), [printing.ts](../../apps/web/src/server/printing.ts), [seating-dates.ts](../../apps/web/src/server/seating-dates.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: addGuestCommand, archivePrinterCommand, attendeeEmailBulk, attendeeExportBulk, attendeeLabelBulk, attendeeLabelsQuery, attendeeListQuery, attendeeSeatLabelsQuery, badgePrintStateQuery, badgesSetupQuery, contactStatsQuery, contactTimelineQuery, contactValueQuery, createClaimLinksCommand, createPrinterCommand, dateChartsQuery, eventSeatingQuery, getAttendeeQuery, getEventBySlugQuery, getOrganizationQuery, kind, kioskSettingsQuery, listBatchesQuery, listClaimLinksQuery, listMediaQuery, listOccurrencesQuery, listTicketTypesQuery, matchingAttendeeIdsQuery, printLogQuery, printerHeartbeatCommand, printingSetupQuery, q, removeGuestCommand, revokeClaimLinkCommand, seatAssignBulk, seatGroupsQuery, seatingRulesQuery, setAttendeeLabelsCommand, setKioskSettingsCommand, startPrintJobCommand, teamEventBySlugQuery, ticketCancelBulk, ticketResendBulk, ticketSummariesQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/badges/[templateId]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/badges/[templateId]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/badges/[templateId]/page.tsx).
- Direct domain imports: @yayatoh/badges, @yayatoh/pdf, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/badges, @yayatoh/badges/client, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: assignTemplateCommand, badgesSetupQuery, cancelBatchCommand, createTemplateCommand, deleteTemplateCommand, getEventBySlugQuery, getOrganizationQuery, listBatchesQuery, listMediaQuery, overrideBalanceDueCommand, saveTemplateCommand, setDefaultTemplateCommand, startBatchCommand, teamEventBySlugQuery.
- Direct guard calls: notFound.

### web /[locale]/o/[org]/e/[event]/badges/batches/[batchId]/download

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/badges/batches/[batchId]/download/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/badges/batches/[batchId]/download/route.ts).
- Direct domain imports: @yayatoh/badges, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/badges, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: badgesSetupQuery, batchLinkQuery, getEventBySlugQuery, getOrganizationQuery, listBatchesQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: redirect.

### web /[locale]/o/[org]/e/[event]/badges/jobs/[jobId]/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/badges/jobs/[jobId]/pdf/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/badges/jobs/[jobId]/pdf/route.ts).
- Direct domain imports: @yayatoh/badges, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/badges, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badge-pdf.ts](../../apps/web/src/server/badge-pdf.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: badgesSetupQuery, browserJobBadgeQuery, getEventBySlugQuery, getOrganizationQuery, listBatchesQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/badges

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/badges/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/badges/page.tsx).
- Direct domain imports: @yayatoh/badges, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/badges, @yayatoh/badges/client, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: assignTemplateCommand, badgeTicketsQuery, badgesSetupQuery, cancelBatchCommand, createTemplateCommand, deleteTemplateCommand, getEventBySlugQuery, getOrganizationQuery, listBatchesQuery, listMediaQuery, overrideBalanceDueCommand, saveTemplateCommand, setDefaultTemplateCommand, startBatchCommand, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/badges/preview/[templateId]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/badges/preview/[templateId]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/badges/preview/[templateId]/route.ts).
- Direct domain imports: @yayatoh/badges, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/badges, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badge-pdf.ts](../../apps/web/src/server/badge-pdf.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: badgesSetupQuery, getEventBySlugQuery, getOrganizationQuery, listBatchesQuery, listMediaQuery, samplePreviewQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/badges/print/[ticketId]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/badges/print/[ticketId]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/badges/print/[ticketId]/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/badges, @yayatoh/badges/client, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [printing-actions.ts](../../apps/web/src/server/printing-actions.ts), [printing.ts](../../apps/web/src/server/printing.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: archivePrinterCommand, badgePrintStateQuery, badgesSetupQuery, createPrinterCommand, getEventBySlugQuery, getOrganizationQuery, kioskSettingsQuery, listBatchesQuery, listMediaQuery, printLogQuery, printerHeartbeatCommand, printingSetupQuery, setKioskSettingsCommand, startPrintJobCommand, teamEventBySlugQuery.
- Direct guard calls: notFound.

### web /[locale]/o/[org]/e/[event]/badges/printing/[printerId]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/badges/printing/[printerId]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/badges/printing/[printerId]/page.tsx).
- Direct domain imports: @yayatoh/badges, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/badges, @yayatoh/badges/client, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [printing-actions.ts](../../apps/web/src/server/printing-actions.ts), [printing.ts](../../apps/web/src/server/printing.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: archivePrinterCommand, badgesSetupQuery, createPrinterCommand, getEventBySlugQuery, getOrganizationQuery, kioskSettingsQuery, listBatchesQuery, listMediaQuery, printLogQuery, printerHeartbeatCommand, printingSetupQuery, setKioskSettingsCommand, startPrintJobCommand, teamEventBySlugQuery.
- Direct guard calls: notFound.

### web /[locale]/o/[org]/e/[event]/badges/printing

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/badges/printing/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/badges/printing/page.tsx).
- Direct domain imports: @yayatoh/badges, @yayatoh/badges/client, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/badges, @yayatoh/badges/client, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [printing-actions.ts](../../apps/web/src/server/printing-actions.ts), [printing.ts](../../apps/web/src/server/printing.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: archivePrinterCommand, badgesSetupQuery, createPrinterCommand, getEventBySlugQuery, getOrganizationQuery, kioskSettingsQuery, listBatchesQuery, listMediaQuery, printLogQuery, printerHeartbeatCommand, printingSetupQuery, setKioskSettingsCommand, startPrintJobCommand, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/cancel

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/cancel/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/cancel/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: cancellationPreviewQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, massRefundsQuery, startMassRefundCommand, teamEventBySlugQuery, to, transitionEventCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/ce-credits/[certificateId]/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/ce-credits/[certificateId]/pdf/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/ce-credits/[certificateId]/pdf/route.ts).
- Direct domain imports: @yayatoh/ce, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/ce, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [receipt-pdf.ts](../../apps/web/src/server/receipt-pdf.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: certificateDocumentQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/ce-credits

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/ce-credits/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/ce-credits/page.tsx).
- Direct domain imports: @yayatoh/ce, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/ce, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: calculateCreditsCommand, ceSetupQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, removeSessionRuleCommand, setCeSettingsCommand, setSessionRuleCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/command-center

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/command-center/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/command-center/page.tsx).
- Direct domain imports: @yayatoh/command-center, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/alerts, @yayatoh/assistance, @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/checkin, @yayatoh/command-center, @yayatoh/command-center/client, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/media, @yayatoh/notifications, @yayatoh/notifications/numbers, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [command-center.ts](../../apps/web/src/server/command-center.ts), [conference-sources.ts](../../apps/web/src/server/conference-sources.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: def, eventViewQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, reportPresenceCommand, resetWidgetLayoutCommand, saveWidgetLayoutCommand, setModeOverrideCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/command-center/tv

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/command-center/tv/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/command-center/tv/page.tsx).
- Direct domain imports: @yayatoh/command-center, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/command-center, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createDisplayLinkCommand, displayLinksQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, revokeDisplayLinkCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/content

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/content/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/content/page.tsx).
- Direct domain imports: @yayatoh/ai, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [section-content.ts](../../apps/web/src/server/section-content.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addSectionCommand, announcementsQuery, createAnnouncementCommand, creditBalanceQuery, deleteAnnouncementCommand, deleteSectionCommand, eventSectionsQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, reorderSectionsCommand, teamEventBySlugQuery, updateAnnouncementCommand, updateEventCommand, updateSectionCommand.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/copy

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/copy/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/copy/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: duplicateEventCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, saveTemplateCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/dates

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/dates/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/dates/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addOccurrencesCommand, addRecurringOccurrencesCommand, cancelOccurrenceCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listOccurrencesQuery, listSeriesQuery, occurrenceSalesQuery, previewOccurrencesQuery, setEventSeriesCommand, teamEventBySlugQuery, updateOccurrenceCommand.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/day-of

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/day-of/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/day-of/page.tsx).
- Direct domain imports: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/checkin, @yayatoh/checkin-engine, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: admitBalanceDueCommand, admitSessionOverrideCommand, createCheckpointCommand, dayOfQuery, enrollDeviceCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, markGuestsArrivedCommand, scanTicketCommand, setCheckpointArchivedCommand, setDeviceStateCommand, startKioskCommand, stopKioskCommand, supervisorView, teamEventBySlugQuery, undoAdmissionCommand, undoGuestArrivalCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/details

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/details/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/details/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/ui, @yayatoh/venues.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/venues.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: ensureShortLinkCommand, eventDetailsQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listOrdersQuery, listVenuesQuery, orgCategoriesQuery, orgTagsQuery, setEventCurrencyCommand, setEventDetailsCommand, setVanityShortLinkCommand, shortLinksQuery, teamEventBySlugQuery, updateEventCommand.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/donations/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, giftsExportBulk, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/matches/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/matches/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/matches/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: employerExportBulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/matches

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/matches/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/matches/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: cancelMatchCommand, closeMatchCommand, createMatchCommand, employerExportBulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, matchesQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/donations/paddle-raise

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddle-raise/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddle-raise/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: armLevelCommand, closeCallCommand, confirmEntriesCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, paddleConsoleQuery, teamEventBySlugQuery, undoPaddleStepCommand, voidEntryCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/paddle-raise/review

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddle-raise/review/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddle-raise/review/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: armLevelCommand, closeCallCommand, confirmEntriesCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, paddleReviewQuery, teamEventBySlugQuery, undoPaddleStepCommand, voidEntryCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/paddle-raise/spot

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddle-raise/spot/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddle-raise/spot/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/donations/paddle-queue, @yayatoh/donations/paddles, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, spotterStateQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/paddle-raise/sync

- Type: endpoint (POST).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddle-raise/sync/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddle-raise/sync/route.ts).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, recordPaddlesCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/donations/paddles

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddles/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/paddles/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: assignPaddleCommand, bulkAssignPaddlesCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, paddlesQuery, releasePaddleCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: createCampaignCommand, createLevelCommand, deleteLevelCommand, donationsConsoleQuery, getEventBySlugQuery, getOrganizationQuery, giftsExportBulk, listMediaQuery, matchesQuery, teamEventBySlugQuery, updateCampaignCommand.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/donations/pledges

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/pledges/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/pledges/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/donations/collection, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: closePledgesCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, pledgeCollectionQuery, recordPledgePaymentCommand, teamEventBySlugQuery, writeOffPledgeCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/receipts/[receiptId]/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/receipts/[receiptId]/pdf/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/receipts/[receiptId]/pdf/route.ts).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [receipt-pdf.ts](../../apps/web/src/server/receipt-pdf.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, receiptDocumentQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/receipts

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/receipts/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/receipts/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/alerts, @yayatoh/attendees, @yayatoh/auth, @yayatoh/automations, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/ce, @yayatoh/checkin, @yayatoh/cms, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/forms, @yayatoh/guests, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/leads, @yayatoh/media, @yayatoh/messaging, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [conference-sources.ts](../../apps/web/src/server/conference-sources.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [delivery-webhooks.ts](../../apps/web/src/server/delivery-webhooks.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [notifications.ts](../../apps/web/src/server/notifications.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: clearFairValueCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, receiptsConsoleQuery, setFairValueCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/donations/reconciliation

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/reconciliation/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/reconciliation/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: donationReconciliationQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, resolveDonationReconItemCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/donations/report/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/report/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/report/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: bulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/report

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/report/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/report/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: bulk, donationReportQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/donations/screen/cards

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/screen/cards/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/screen/cards/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [engagement.ts](../../apps/web/src/server/engagement.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, screenSettingsQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/donations/screen

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/donations/screen/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/donations/screen/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/donations/screen, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [engagement.ts](../../apps/web/src/server/engagement.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, rotateScreenLinkCommand, saveScreenCommand, screenSettingsQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/engagement

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/engagement/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/engagement/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/engagement, @yayatoh/engagement/client, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: eventScoresQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, resetScoreWeightsCommand, setScoreWeightsCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/exhibitors/booths

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/booths/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/booths/page.tsx).
- Direct domain imports: @yayatoh/floorplan, @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/floorplan, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [booths.ts](../../apps/web/src/server/booths.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: assignBoothCommand, boothPlanQuery, deleteBoothCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, programQuery, saveBoothCommand, teamEventBySlugQuery, unassignBoothCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/exhibitors/licenses

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/licenses/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/licenses/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, leadLicensesAdminQuery, listMediaQuery, programQuery, saveLeadLicenseSettingsCommand, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/exhibitors

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/page.tsx).
- Direct domain imports: @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createExhibitorCommand, deleteExhibitorCommand, family, getEventBySlugQuery, getOrganizationQuery, libraryQuery, listMediaQuery, listOwnersMediaQuery, programQuery, teamEventBySlugQuery, updateExhibitorCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/exhibitors/portal

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/portal/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/portal/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: decideProfileChangeCommand, exhibitorPortalAdminQuery, getEventBySlugQuery, getOrganizationQuery, inviteExhibitorMemberCommand, listMediaQuery, programQuery, resendExhibitorInviteCommand, revokeExhibitorMemberCommand, saveExhibitorListingCommand, saveExhibitorSettingsCommand, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/gallery

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/gallery/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/gallery/page.tsx).
- Direct domain imports: @yayatoh/gallery, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/gallery, @yayatoh/gallery/client, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addGalleryVideoCommand, getEventBySlugQuery, getOrganizationQuery, hostGalleryQuery, hostSlidesQuery, listMediaQuery, requestGalleryUploadCommand, saveGallerySettingsCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/gallery/slideshow

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/gallery/slideshow/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/gallery/slideshow/page.tsx).
- Direct domain imports: @yayatoh/gallery, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/gallery, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addGalleryVideoCommand, getEventBySlugQuery, getOrganizationQuery, hostSlidesQuery, listMediaQuery, requestGalleryUploadCommand, saveGallerySettingsCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound, requireOrg.

### web /[locale]/o/[org]/e/[event]/guests/answers/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/answers/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/answers/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: bulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/answers

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/answers/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/answers/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: bulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, mealCountsQuery, rsvpOverviewQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/collector/[submission]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/collector/[submission]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/collector/[submission]/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: approveSubmissionCommand, collectorMergePreviewQuery, getEventBySlugQuery, getOrganizationQuery, guestListQuery, listMediaQuery, mergeSubmissionCommand, rejectSubmissionCommand, setCollectorCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/collector

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/collector/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/collector/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: approveSubmissionCommand, collectorQueueQuery, collectorSettingsQuery, getEventBySlugQuery, getOrganizationQuery, guestListQuery, listMediaQuery, mergeSubmissionCommand, rejectSubmissionCommand, setCollectorCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/import/[batch]/rejected

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/import/[batch]/rejected/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/import/[batch]/rejected/route.ts).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, guestImportRejectedQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/import

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/import/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/import/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/guests/sheet, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, guestImportBulk, guestImportSummaryQuery, listMediaQuery, stageGuestImportCommand, teamEventBySlugQuery, validateGuestImportCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/invitations

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/invitations/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/invitations/page.tsx).
- Direct domain imports: @yayatoh/automations, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/automations, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: command, createRsvpLinksCommand, getEventBySlugQuery, getOrganizationQuery, guestListQuery, invitationPreviewQuery, invitationTemplatesQuery, listMediaQuery, partyInvitesQuery, resetInvitationTemplateCommand, rsvpOverviewQuery, rsvpRemindersQuery, sendInvitationsCommand, sendTestInvitationCommand, setInvitationTemplateCommand, setPartyContactCommand, setPartyLocaleCommand, setRsvpRemindersCommand, setRsvpSettingsCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/page.tsx).
- Direct domain imports: @yayatoh/attendees, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addPartyGuestCommand, addPlusOneCommand, command, createPartyCommand, createRsvpLinksCommand, getEventBySlugQuery, getOrganizationQuery, guestListQuery, listAttendeesQuery, listMediaQuery, moveGuestCommand, partyHistoryQuery, removePartyCommand, removePartyGuestCommand, rsvpLinksQuery, rsvpOverviewQuery, setRsvpSettingsCommand, teamEventBySlugQuery, updatePartyCommand, updatePartyGuestCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/questions

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/questions/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/questions/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/forms/ui, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, publishRsvpQuestionsCommand, removeMenuOptionCommand, rsvpQuestionsQuery, saveMenuOptionCommand, subEventsQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/rsvp/[party]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/rsvp/[party]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/rsvp/[party]/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/automations, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: command, createRsvpLinksCommand, finderSettingsQuery, getEventBySlugQuery, getOrganizationQuery, guestListQuery, listMediaQuery, partyContactQuery, partyInviteMessagesQuery, partyInvitesQuery, partyRemindersQuery, partyRsvpQuery, resetInvitationTemplateCommand, rsvpOverviewQuery, sendInvitationsCommand, sendTestInvitationCommand, setInvitationTemplateCommand, setPartyContactCommand, setPartyLocaleCommand, setRsvpRemindersCommand, setRsvpSettingsCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/rsvp

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/rsvp/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/rsvp/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: command, createRsvpLinksCommand, getEventBySlugQuery, getOrganizationQuery, guestListQuery, listMediaQuery, rsvpOverviewQuery, setRsvpSettingsCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/guests/sub-events

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/guests/sub-events/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/guests/sub-events/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui, @yayatoh/venues.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/venues.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createSubEventCommand, getEventBySlugQuery, getOrganizationQuery, giveSubEventOwnChartCommand, invitationMatrixQuery, listLayoutsQuery, listMediaQuery, listOccurrencesQuery, listVenuesQuery, moveSubEventCommand, recordSubEventResponseCommand, removeSubEventChartCommand, removeSubEventCommand, setInvitationsCommand, subEventChartsQuery, subEventHistoryQuery, teamEventBySlugQuery, updateSubEventCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/marketing

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/messaging, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/messaging, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: announcementsQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, previewAnnouncementQuery, sendAnnouncementCommand, storeEmailPreviewCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/marketing/surveys/[survey]/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/surveys/[survey]/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/surveys/[survey]/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/surveys.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, surveyExportBulk, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/marketing/surveys/[survey]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/surveys/[survey]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/surveys/[survey]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/surveys, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: createSurveyCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, saveSurveyQuestionsCommand, sendSurveyCommand, setSurveyClosedCommand, surveyExportBulk, surveyQuery, surveyTargetsQuery, teamEventBySlugQuery, updateSurveyCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/marketing/surveys

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/surveys/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/surveys/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/surveys, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createSurveyCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listSurveysQuery, saveSurveyQuestionsCommand, sendSurveyCommand, setSurveyClosedCommand, surveyExportBulk, surveyQuery, surveyTargetsQuery, teamEventBySlugQuery, updateSurveyCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/media

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/media/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/media/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: family, getEventBySlugQuery, getOrganizationQuery, libraryQuery, listMediaQuery, listOwnersMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/networking

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/networking/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/networking/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addMeetingSlotsCommand, chatConsoleQuery, creditBalanceQuery, deleteMeetingLocationCommand, deleteMeetingSlotCommand, getEventBySlugQuery, getOrganizationQuery, listBrandKitsQuery, listMediaQuery, matchmakingStatusQuery, moderateChatReportCommand, networkConsoleQuery, removeChatMessageCommand, resolveReportCommand, restoreBoothChatCommand, restoreProfileCommand, saveMeetingLocationCommand, teamEventBySlugQuery, updateNetworkSettingsCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/onsite

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/checkin, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/checkin, @yayatoh/checkin-engine, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: admitBalanceDueCommand, admitSessionOverrideCommand, checkinStatusQuery, createCheckpointCommand, doorStaffQuery, enrollDeviceCommand, getEventBySlugQuery, getOrganizationQuery, listCheckpointsQuery, listDevicesQuery, listMediaQuery, listTicketTypesQuery, myScanScopeQuery, scanTicketCommand, setCheckpointArchivedCommand, setDeviceStateCommand, teamEventBySlugQuery, undoAdmissionCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/onsite/sessions/[checkpoint]/flyer

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/sessions/[checkpoint]/flyer/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/sessions/[checkpoint]/flyer/page.tsx).
- Direct domain imports: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, sessionAttendanceQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/onsite/sessions

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/sessions/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/sessions/page.tsx).
- Direct domain imports: @yayatoh/checkin, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createCheckpointCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, sessionAttendanceQuery, sessionDoorChoicesQuery, setSelfCheckinCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/onsite/signals

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/signals/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/signals/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/checkin, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: detectionSettingsQuery, getEventBySlugQuery, getOrganizationQuery, listFraudSignalsQuery, listMediaQuery, resolveFraudSignalCommand, setDetectionSettingsCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/onsite/staff

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/staff/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/onsite/staff/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/checkin, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: doorStaffQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listMembersQuery, removeDoorStaffCommand, setDoorStaffCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/orders/[orderId]/credit-notes/[creditNoteId]/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/credit-notes/[creditNoteId]/pdf/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/credit-notes/[creditNoteId]/pdf/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/pdf, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: creditNoteDocumentQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/orders/[orderId]/disputes/[disputeId]/evidence

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/disputes/[disputeId]/evidence/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/disputes/[disputeId]/evidence/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [evidence.ts](../../apps/web/src/server/evidence.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: disputeEvidencePacketQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/orders/[orderId]/disputes/[disputeId]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/disputes/[disputeId]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/disputes/[disputeId]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/payments, @yayatoh/reports, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [evidence.ts](../../apps/web/src/server/evidence.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [payments.ts](../../apps/web/src/server/payments.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: disputeEvidencePacketQuery, disputeEvidenceQuery, disputesQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, markOrgEvidenceSubmittedCommand, orderDetailQuery, saveEvidenceDraftCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/orders/[orderId]/invoice/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/invoice/pdf/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/invoice/pdf/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [invoice-pdf.ts](../../apps/web/src/server/invoice-pdf.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, invoiceDocumentQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/orders/[orderId]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/checkin, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/reports, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: addOrderNoteCommand, cancelTransferCommand, creditNotesQuery, declineRefundRequestCommand, disputesQuery, getEventBySlugQuery, getOrganizationQuery, issueCreditNoteCommand, listMediaQuery, orderAttributionQuery, orderDetailQuery, orderInvoiceQuery, orderMessagesQuery, orderRefundsQuery, orderSignalsQuery, orderTimelineQuery, orderTransfersQuery, orderWalletPassesQuery, previewSupportMacroQuery, recordInvoicePaymentCommand, refundRequestsQuery, reissueManageLinkCommand, resolveFraudSignalCommand, runSupportMacroCommand, setDetectionSettingsCommand, startTransferCommand, supportMacrosQuery, teamEventBySlugQuery, ticketSeatLabelsQuery, voidInvoiceCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/ui.
- Connected packages: @yayatoh/alerts, @yayatoh/auth, @yayatoh/billing, @yayatoh/command-center/client, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [alerts.ts](../../apps/web/src/server/alerts.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [demo.ts](../../apps/web/src/server/demo.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [readiness.ts](../../apps/web/src/server/readiness.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: alertCountQuery, eventDetailsQuery, eventFinanceKpisQuery, eventKpisQuery, eventSeatingQuery, eventSectionsQuery, getEventBySlugQuery, getOrganizationQuery, guestCountQuery, guestSitePublishedQuery, listAlertsQuery, listMediaQuery, listOccurrencesQuery, listTicketTypesQuery, programCountsQuery, teamEventBySlugQuery, transitionEventCommand.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/registration-form

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/registration-form/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/registration-form/page.tsx).
- Direct domain imports: @yayatoh/crm, @yayatoh/forms, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/events, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/registration, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [registration-types.ts](../../apps/web/src/server/registration-types.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, getRegistrationFormQuery, listJobTitlesQuery, listMediaQuery, publishRegistrationFormCommand, registrationTypeRefsQuery, setJobTitlesCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/registration/applications

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/registration/applications/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/registration/applications/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: approvalSetupQuery, decideRegistrantCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, registrantDetailQuery, registrationDecideBulk, registrationQueueQuery, registrationSetupQuery, removeReasonTemplateCommand, saveReasonTemplateCommand, substituteRegistrantCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/registration/enrollment

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/registration/enrollment/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/registration/enrollment/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/registration, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: enrollmentOverviewQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, promoteSessionNowCommand, setEnrollmentSettingsCommand, setItemSessionsCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/registration/invoices

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/registration/invoices/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/registration/invoices/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: eventInvoicesQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/registration

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/registration/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/registration/page.tsx).
- Direct domain imports: @yayatoh/audiences, @yayatoh/kernel, @yayatoh/platform, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/registration, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: approvalSetupQuery, archiveAdmissionItemCommand, archiveRegistrationTypeCommand, createAdmissionItemCommand, createRegistrationTypeCommand, disableCellCommand, getEventBySlugQuery, getOrganizationQuery, getSegmentQuery, listMediaQuery, listSegmentsQuery, payLaterRulesQuery, previewAudienceQuery, registrationSetupQuery, replaceMembersCommand, seedRegistrationDefaultsCommand, setCellCommand, setPayLaterCommand, setTypeRulesCommand, teamEventBySlugQuery, updateAdmissionItemCommand, updateRegistrationTypeCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/reviews

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/reviews/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/reviews/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reviews, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reviews, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: dismissReportsCommand, getEventBySlugQuery, getOrganizationQuery, hideReviewCommand, listMediaQuery, listReviewsQuery, teamEventBySlugQuery, unhideReviewCommand.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/seat-finder

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seat-finder/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seat-finder/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, redirect.

### web /[locale]/o/[org]/e/[event]/seating/assign

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/assign/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/assign/page.tsx).
- Direct domain imports: @yayatoh/attendees, @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [seating-dates.ts](../../apps/web/src/server/seating-dates.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: allocateGroupSeatsCommand, assignSeatCategoryCommand, assignSeatsCommand, attendeeLabelsQuery, dateChartsQuery, eventSeatingQuery, getEventBySlugQuery, getOrganizationQuery, giveDateOwnChartCommand, listMediaQuery, listOccurrencesQuery, publishEventLayoutCommand, releaseGroupSeatsCommand, removeDateChartCommand, saveLayoutCommand, seatAssignBulk, seatAssignmentsQuery, seatGroupsQuery, seatingRulesQuery, setCompanionSeatsCommand, setEventLayoutCommand, setFinderSettingsCommand, setSeatingRulesCommand, setSelectionSettingsCommand, teamEventBySlugQuery, unassignSeatsCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/best-available

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/best-available/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/best-available/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: allocateGroupSeatsCommand, assignSeatCategoryCommand, assignSeatsCommand, getEventBySlugQuery, getOrganizationQuery, giveDateOwnChartCommand, listMediaQuery, publishEventLayoutCommand, releaseGroupSeatsCommand, removeDateChartCommand, saveLayoutCommand, seatAssignBulk, seatingRulesQuery, selectionPageQuery, setCompanionSeatsCommand, setEventLayoutCommand, setFinderSettingsCommand, setSeatingRulesCommand, setSelectionSettingsCommand, teamEventBySlugQuery, unassignSeatsCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/cards/export

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/cards/export/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/cards/export/route.ts).
- Direct domain imports: @yayatoh/csv, @yayatoh/kernel, @yayatoh/seating.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/csv, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [seating-cards.ts](../../apps/web/src/server/seating-cards.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: exportGuestSeatingCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/cards

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/cards/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/cards/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, seatingCardsQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/cards/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/cards/pdf/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/cards/pdf/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/seating.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [seating-cards.ts](../../apps/web/src/server/seating-cards.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, seatingCardsQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/channels

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/channels/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/channels/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: allotSeatsCommand, deleteSeatChannelCommand, eventSeatingQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, restoreLayoutRevisionCommand, saveSeatChannelCommand, seatChannelsQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/finder

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/finder/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/finder/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: acceptAgreementCommand, allocateGroupSeatsCommand, assignSeatCategoryCommand, assignSeatsCommand, finderSettingsQuery, getEventBySlugQuery, getOrganizationQuery, giveDateOwnChartCommand, listMediaQuery, publishEventLayoutCommand, releaseGroupSeatsCommand, removeDateChartCommand, saveLayoutCommand, seatAssignBulk, seatingRulesQuery, setCompanionSeatsCommand, setEventLayoutCommand, setFinderSettingsCommand, setLegalPageCommand, setSeatingRulesCommand, setSelectionSettingsCommand, teamEventBySlugQuery, unassignSeatsCommand, updateOrganizationCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/guests

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/guests/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/guests/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, guestSeatingQuery, listMediaQuery, seatGuestsCommand, setVipTableCommand, teamEventBySlugQuery, unseatGuestsCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [seating-dates.ts](../../apps/web/src/server/seating-dates.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: acceptAgreementCommand, allocateGroupSeatsCommand, assignSeatCategoryCommand, assignSeatsCommand, dateChartsQuery, eventSeatingQuery, getEventBySlugQuery, getOrganizationQuery, giveDateOwnChartCommand, libraryQuery, listLayoutsQuery, listMediaQuery, listOccurrencesQuery, listOwnersMediaQuery, listTicketTypesQuery, planTablesQuery, publishEventLayoutCommand, releaseGroupSeatsCommand, removeDateChartCommand, saveLayoutCommand, seatAssignBulk, seatingRulesQuery, setCompanionSeatsCommand, setEventLayoutCommand, setFinderSettingsCommand, setLegalPageCommand, setSeatingRulesCommand, setSelectionSettingsCommand, teamEventBySlugQuery, unassignSeatsCommand, updateOrganizationCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/revisions

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/revisions/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/revisions/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [seating-dates.ts](../../apps/web/src/server/seating-dates.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: allotSeatsCommand, dateChartsQuery, deleteSeatChannelCommand, eventSeatingQuery, getEventBySlugQuery, getOrganizationQuery, layoutRevisionQuery, layoutRevisionsQuery, listMediaQuery, listOccurrencesQuery, restoreLayoutRevisionCommand, saveSeatChannelCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/rules

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/rules/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/rules/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: allocateGroupSeatsCommand, assignSeatCategoryCommand, assignSeatsCommand, getEventBySlugQuery, getOrganizationQuery, giveDateOwnChartCommand, listMediaQuery, publishEventLayoutCommand, releaseGroupSeatsCommand, removeDateChartCommand, saveLayoutCommand, seatAssignBulk, seatingLiveAccessQuery, seatingRulesQuery, setCompanionSeatsCommand, setEventLayoutCommand, setFinderSettingsCommand, setSeatingRulesCommand, setSelectionSettingsCommand, teamEventBySlugQuery, unassignSeatsCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/solver

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/solver/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/solver/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: acceptSeatingProposalCommand, addSolverRuleCommand, getEventBySlugQuery, getOrganizationQuery, guestSeatingQuery, listMediaQuery, removeSolverRuleCommand, solverSetupQuery, teamEventBySlugQuery, updateSolverRuleCommand.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/seating/stream

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/seating/stream/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/seating/stream/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/seating, @yayatoh/tenancy.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, seatingLiveAccessQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/sessions/[session]/live

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/sessions/[session]/live/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/sessions/[session]/live/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/engagement, @yayatoh/engagement/client, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [engagement.ts](../../apps/web/src/server/engagement.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: closePollCommand, createPollCommand, deletePollCommand, enableLiveCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, moderateQuestionCommand, moderationQuery, openPollCommand, pinQuestionCommand, presentPollCommand, programQuery, rotateDisplayLinkCommand, setPollResultsCommand, teamEventBySlugQuery, updateSettingsCommand.
- Direct guard calls: notFound.

### web /[locale]/o/[org]/e/[event]/sessions/[session]/live/present

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/sessions/[session]/live/present/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/sessions/[session]/live/present/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/engagement, @yayatoh/engagement/client, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [engagement.ts](../../apps/web/src/server/engagement.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, moderationQuery, programQuery, teamEventBySlugQuery.
- Direct guard calls: notFound.

### web /[locale]/o/[org]/e/[event]/sessions/import

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/sessions/import/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/sessions/import/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: agendaImportPreviewQuery, getEventBySlugQuery, getOrganizationQuery, importAgendaCommand, listMediaQuery, programQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/sessions

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/sessions/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/sessions/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [agenda.ts](../../apps/web/src/server/agenda.ts), [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addCfpQuestionCommand, addCfpReviewerCommand, addStandardSessionTypesCommand, agendaQuery, assignCfpReviewerCommand, assignNewSpeakersCommand, createPortalTaskCommand, createRoomCommand, createSessionCommand, createSessionGroupCommand, createSessionTypeCommand, createTrackCommand, creditBalanceQuery, decideCfpSubmissionCommand, decideSpeakerChangeCommand, deletePortalTaskCommand, deleteRoomCommand, deleteSessionCommand, deleteSessionGroupCommand, deleteSessionTypeCommand, deleteTrackCommand, getEventBySlugQuery, getOrganizationQuery, inviteSpeakerCommand, listBrandKitsQuery, listMediaQuery, listOccurrencesQuery, liveSessionsQuery, placeDraftSessionCommand, programQuery, publishAgendaCommand, remindMissingCommand, removeCfpQuestionCommand, revokeCfpReviewerCommand, revokeSpeakerAccessCommand, saveCfpCommand, setSessionAgendaCommand, teamEventBySlugQuery, unassignCfpReviewerCommand, unpublishAgendaCommand, updateSessionCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/setup-guide

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/setup-guide/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/setup-guide/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/command-center/client, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [readiness.ts](../../apps/web/src/server/readiness.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addChecklistItemCommand, deleteChecklistItemCommand, eventChecklistQuery, eventDetailsQuery, eventSeatingQuery, eventSectionsQuery, getEventBySlugQuery, getOrganizationQuery, guestCountQuery, guestSitePublishedQuery, listMediaQuery, listOccurrencesQuery, listTicketTypesQuery, programCountsQuery, setChecklistItemDoneCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/speakers/cfp/[submission]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/cfp/[submission]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/cfp/[submission]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addCfpQuestionCommand, addCfpReviewerCommand, assignCfpReviewerCommand, assignNewSpeakersCommand, cfpOverviewQuery, cfpSubmissionQuery, createPortalTaskCommand, decideCfpSubmissionCommand, decideSpeakerChangeCommand, deletePortalTaskCommand, getEventBySlugQuery, getOrganizationQuery, inviteSpeakerCommand, listMediaQuery, placeDraftSessionCommand, programQuery, remindMissingCommand, removeCfpQuestionCommand, revokeCfpReviewerCommand, revokeSpeakerAccessCommand, saveCfpCommand, teamEventBySlugQuery, unassignCfpReviewerCommand.
- Direct guard calls: notFound.

### web /[locale]/o/[org]/e/[event]/speakers/cfp

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/cfp/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/cfp/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: cfpOverviewQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, programQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/speakers/cfp/reviewers

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/cfp/reviewers/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/cfp/reviewers/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addCfpQuestionCommand, addCfpReviewerCommand, assignCfpReviewerCommand, assignNewSpeakersCommand, cfpOverviewQuery, createPortalTaskCommand, decideCfpSubmissionCommand, decideSpeakerChangeCommand, deletePortalTaskCommand, getEventBySlugQuery, getOrganizationQuery, inviteSpeakerCommand, listMediaQuery, placeDraftSessionCommand, programQuery, remindMissingCommand, removeCfpQuestionCommand, revokeCfpReviewerCommand, revokeSpeakerAccessCommand, saveCfpCommand, teamEventBySlugQuery, unassignCfpReviewerCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/speakers/cfp/settings

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/cfp/settings/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/cfp/settings/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addCfpQuestionCommand, addCfpReviewerCommand, assignCfpReviewerCommand, assignNewSpeakersCommand, cfpOverviewQuery, createPortalTaskCommand, decideCfpSubmissionCommand, decideSpeakerChangeCommand, deletePortalTaskCommand, getEventBySlugQuery, getOrganizationQuery, inviteSpeakerCommand, listMediaQuery, placeDraftSessionCommand, programQuery, remindMissingCommand, removeCfpQuestionCommand, revokeCfpReviewerCommand, revokeSpeakerAccessCommand, saveCfpCommand, teamEventBySlugQuery, unassignCfpReviewerCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/speakers/changes

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/changes/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/changes/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: assignNewSpeakersCommand, createPortalTaskCommand, decideSpeakerChangeCommand, deletePortalTaskCommand, getEventBySlugQuery, getOrganizationQuery, inviteSpeakerCommand, listMediaQuery, programQuery, remindMissingCommand, revokeSpeakerAccessCommand, speakerChangesQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/speakers

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: assignNewSpeakersCommand, createPortalTaskCommand, createSpeakerCommand, decideSpeakerChangeCommand, deletePortalTaskCommand, deleteSpeakerCommand, family, getEventBySlugQuery, getOrganizationQuery, inviteSpeakerCommand, libraryQuery, listMediaQuery, listOwnersMediaQuery, programQuery, remindMissingCommand, revokeSpeakerAccessCommand, speakerAccessQuery, speakerChangesQuery, teamEventBySlugQuery, updateSpeakerCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/speakers/tasks

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/tasks/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/speakers/tasks/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: assignNewSpeakersCommand, createPortalTaskCommand, decideSpeakerChangeCommand, deletePortalTaskCommand, getEventBySlugQuery, getOrganizationQuery, inviteSpeakerCommand, listMediaQuery, portalTaskBoardQuery, programQuery, remindMissingCommand, revokeSpeakerAccessCommand, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/sponsors/deliverables

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/sponsors/deliverables/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/sponsors/deliverables/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addSponsorDeliverableCommand, deleteSponsorDeliverableCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, programQuery, setSponsorDeliverableDoneCommand, sponsorDeliverablesQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/sponsors/packages

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/sponsors/packages/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/sponsors/packages/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: assignSponsoredSessionCommand, cancelSponsorGrantCommand, getEventBySlugQuery, getOrganizationQuery, grantSponsorPackageCommand, inviteSponsorContactCommand, listMediaQuery, programQuery, resendSponsorInviteCommand, revokeSponsorContactCommand, saveSponsorPackageCommand, setSponsorExhibitorCommand, sponsorshipAdminQuery, teamEventBySlugQuery, unassignSponsoredSessionCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/sponsors

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/sponsors/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/sponsors/page.tsx).
- Direct domain imports: @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [program.ts](../../apps/web/src/server/program.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createSponsorCommand, createSponsorTierCommand, deleteSponsorCommand, deleteSponsorTierCommand, family, getEventBySlugQuery, getOrganizationQuery, libraryQuery, listMediaQuery, listOwnersMediaQuery, programQuery, teamEventBySlugQuery, updateSponsorCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/e/[event]/tables-sponsors

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/tables-sponsors/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/tables-sponsors/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/media, @yayatoh/orders, @yayatoh/seating, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, hostNameTableSlotCommand, hostedTablesQuery, listMediaQuery, listTicketTypesQuery, planTablesQuery, removeTableSponsorCommand, sendTableRemindersCommand, setTableSponsorCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/team

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/team/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/team/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: changeMemberRoleCommand, changeTeamRoleCommand, eventTeamQuery, getEventBySlugQuery, getOrganizationQuery, inviteMemberCommand, inviteTeamMemberCommand, listMediaQuery, removeMemberCommand, removeTeamMemberCommand, revokeInvitationCommand, revokeTeamInvitationCommand, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/tickets-orders

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/tickets-orders/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/tickets-orders/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/orders, @yayatoh/seating, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/floorplan, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: archiveTicketTypeCommand, checkoutSettingsQuery, createPromoCodeCommand, createTicketTypeCommand, dateChartsQuery, getEventBySlugQuery, getFormQuery, getOrganizationQuery, holdBestAvailableStaffCommand, listMediaQuery, listOccurrencesQuery, listOrdersQuery, listPromoCodesQuery, listResponsesQuery, listTicketTypesQuery, publishFormCommand, recordBoxOfficeSaleCommand, refundPolicyQuery, releaseBestAvailableCommand, setCheckoutSettingsCommand, setPromoCodeActiveCommand, setRefundPolicyCommand, teamEventBySlugQuery, updateTicketTypeCommand.
- Direct guard calls: loadEvent.

### web /[locale]/o/[org]/e/[event]/tickets-orders/waitlists/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/tickets-orders/waitlists/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/e/[event]/tickets-orders/waitlists/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery, waitlistExportBulk.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/tickets-orders/waitlists

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/tickets-orders/waitlists/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/tickets-orders/waitlists/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listWaitlistsQuery, offerWaitlistEntryCommand, removeWaitlistEntriesCommand, teamEventBySlugQuery, updateWaitlistCommand, waitlistEntriesQuery, waitlistExportBulk.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/tracked-links/[link]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/tracked-links/[link]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/tracked-links/[link]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/marketing, @yayatoh/pdf, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, linkDetailQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/tracked-links

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/tracked-links/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/tracked-links/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/marketing, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: attributionSettingsQuery, createTrackedLinkCommand, getEventBySlugQuery, getOrganizationQuery, linkReportQuery, listMediaQuery, setAttributionWindowCommand, teamEventBySlugQuery, utmOnlyReportQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/virtual

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/virtual/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/virtual/page.tsx).
- Direct domain imports: @yayatoh/checkin, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/ui, @yayatoh/virtual.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/events, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/virtual.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createStreamCommand, getEventBySlugQuery, getOrganizationQuery, linkZoomWebinarCommand, listConnectionsQuery, listMediaQuery, requestSyncCommand, revealStreamKeyCommand, setActiveIngestCommand, setEventDetailsCommand, setStreamEnabledCommand, setTicketAccessCommand, switchStreamProviderCommand, syncZoomRegistrantsCommand, teamEventBySlugQuery, virtualCheckpointsQuery, virtualSetupQuery, zoomConnectedQuery, zoomSetupQuery.
- Direct guard calls: loadEvent, notFound.

### web /[locale]/o/[org]/e/[event]/website

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/e/[event]/website/page.tsx](../../apps/web/src/app/[locale]/o/[org]/e/[event]/website/page.tsx).
- Direct domain imports: @yayatoh/contracts, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addGuestSiteBlockCommand, getEventBySlugQuery, getOrganizationQuery, guestSiteQuery, listMediaQuery, moveGuestSiteBlockCommand, publishGuestSiteCommand, removeGuestSiteBlockCommand, saveGuestSiteCommand, setGuestSitePasswordCommand, subEventsQuery, teamEventBySlugQuery, updateGuestSiteBlockCommand.
- Direct guard calls: loadEvent, notFound.

## onsite tools

### web /[locale]/scan/leads

- Type: page.
- Source: [apps/web/src/app/[locale]/scan/leads/page.tsx](../../apps/web/src/app/[locale]/scan/leads/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/kernel, @yayatoh/leads/rules, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/scan

- Type: page.
- Source: [apps/web/src/app/[locale]/scan/page.tsx](../../apps/web/src/app/[locale]/scan/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/assistance/client, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/badges/client, @yayatoh/checkin, @yayatoh/checkin-engine, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [scan-supervisor-actions.ts](../../apps/web/src/server/scan-supervisor-actions.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: claimStaffPushCommand, requestDeviceSyncCommand, revokeDeviceCommand, startKioskCommand, stopKioskCommand, supervisorView, switchDeviceCheckpointCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

## organization console

### web /[locale]/o/[org]/activity/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/activity/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/activity/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: auditExportBulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/activity

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/activity/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/activity/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: auditExportBulk, auditLogQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/agencies

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agencies/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agencies/page.tsx).
- Direct domain imports: @yayatoh/agency-ops, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: acceptAgencyBillingCommand, applyBrandKitCommand, clientAgencyBillingQuery, clientAgencyOpsQuery, clientCommissionStatementQuery, detachAgencyCommand, endAgencyBillingCommand, getEventBySlugQuery, getOrganizationQuery, grantAgencyAccessCommand, listAgencyGrantsQuery, listAgencyStaffGrantsQuery, listMediaQuery, revokeAgencyGrantCommand, revokeAgencyStaffGrantCommand, teamEventBySlugQuery, updateAgencyGrantCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/agency/billing

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agency/billing/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agency/billing/page.tsx).
- Direct domain imports: @yayatoh/agency, @yayatoh/billing, @yayatoh/kernel, @yayatoh/payments, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: acceptAgencyBillingCommand, agencyBilledClientsQuery, agencyClientsQuery, agencyCommissionStatementQuery, applyBrandKitCommand, clientAgencyBillingQuery, clientCommissionStatementQuery, detachAgencyCommand, endAgencyBillingCommand, getEventBySlugQuery, getOrganizationQuery, grantAgencyAccessCommand, listMediaQuery, offerAgencyBillingCommand, refreshAgencySnapshotsCommand, revokeAgencyGrantCommand, revokeAgencyStaffGrantCommand, teamEventBySlugQuery, updateAgencyGrantCommand, withdrawAgencyBillingOfferCommand.
- Direct guard calls: notFound.

### web /[locale]/o/[org]/agency/campaigns

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agency/campaigns/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agency/campaigns/page.tsx).
- Direct domain imports: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: agencyClientsQuery, agencyFanoutsQuery, assignStaffCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, revokeStaffCommand, saveBrandKitCommand, setTemplatePrivacyCommand, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/agency/events

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agency/events/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agency/events/page.tsx).
- Direct domain imports: @yayatoh/agency, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: agencyEventsQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/agency/library

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agency/library/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agency/library/page.tsx).
- Direct domain imports: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/kernel, @yayatoh/templates, @yayatoh/ui.
- Connected packages: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: agencyClientsQuery, agencyLibraryQuery, assignStaffCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listTemplatesQuery, revokeStaffCommand, saveBrandKitCommand, setTemplatePrivacyCommand, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/agency/marketing

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agency/marketing/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agency/marketing/page.tsx).
- Direct domain imports: @yayatoh/agency, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: agencyClientsQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/agency

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agency/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agency/page.tsx).
- Direct domain imports: @yayatoh/agency, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: agencyClientsQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/agency/reports

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agency/reports/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agency/reports/page.tsx).
- Direct domain imports: @yayatoh/agency, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: agencyClientsQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/agency/team

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/agency/team/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/agency/team/page.tsx).
- Direct domain imports: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/agency, @yayatoh/agency-ops, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: agencyClientsQuery, agencyEventsQuery, agencyStaffQuery, assignStaffCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listMembersQuery, revokeStaffCommand, saveBrandKitCommand, setTemplatePrivacyCommand, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/alerts

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/alerts/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/alerts/page.tsx).
- Direct domain imports: @yayatoh/alerts, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/alerts, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [alerts.ts](../../apps/web/src/server/alerts.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: acknowledgeAlertCommand, alertCountQuery, alertHistoryQuery, getEventBySlugQuery, getOrganizationQuery, listAlertsQuery, listEventsQuery, listMediaQuery, setAlertRoutingCommand, setMyAlertPhoneCommand, setSalesTargetCommand, snoozeAlertCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/alerts/settings

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/alerts/settings/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/alerts/settings/page.tsx).
- Direct domain imports: @yayatoh/alerts, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/alerts, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: acknowledgeAlertCommand, alertRoutingQuery, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, myAlertSettingsQuery, salesTargetQuery, setAlertRoutingCommand, setMyAlertPhoneCommand, setSalesTargetCommand, snoozeAlertCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/analytics/alerts/[ruleId]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/analytics/alerts/[ruleId]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/analytics/alerts/[ruleId]/page.tsx).
- Direct domain imports: @yayatoh/analytics, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [analytics-pro.ts](../../apps/web/src/server/analytics-pro.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createAlertRuleCommand, deleteAlertRuleCommand, getAlertRuleQuery, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, listMembersQuery, setAlertRuleEnabledCommand, teamEventBySlugQuery, updateAlertRuleCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/analytics/alerts

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/analytics/alerts/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/analytics/alerts/page.tsx).
- Direct domain imports: @yayatoh/analytics, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [analytics-pro.ts](../../apps/web/src/server/analytics-pro.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createAlertRuleCommand, deleteAlertRuleCommand, getEventBySlugQuery, getOrganizationQuery, listAlertRulesQuery, listEventsQuery, listMediaQuery, listMembersQuery, setAlertRuleEnabledCommand, teamEventBySlugQuery, updateAlertRuleCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/analytics/explore/export

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/analytics/explore/export/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/analytics/explore/export/route.ts).
- Direct domain imports: @yayatoh/analytics, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [campaign-names.ts](../../apps/web/src/server/campaign-names.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [explorer.ts](../../apps/web/src/server/explorer.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: campaignNamesQuery, exploreMoneyQuery, exploreQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/analytics/explore

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/analytics/explore/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/analytics/explore/page.tsx).
- Direct domain imports: @yayatoh/analytics, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [campaign-names.ts](../../apps/web/src/server/campaign-names.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [explorer.ts](../../apps/web/src/server/explorer.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: campaignNamesQuery, deleteViewCommand, exploreMoneyQuery, exploreQuery, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, listSavedViewsQuery, saveViewCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound, requireOrg.

### web /[locale]/o/[org]/analytics

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/analytics/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/analytics/page.tsx).
- Direct domain imports: @yayatoh/analytics, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: backfillStatusQuery, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, orgDashboardQuery, orgRevenueQuery, startBackfillCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound, requireOrg.

### web /[locale]/o/[org]/analytics/reports/[scheduleId]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/analytics/reports/[scheduleId]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/analytics/reports/[scheduleId]/page.tsx).
- Direct domain imports: @yayatoh/analytics, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [analytics-pro.ts](../../apps/web/src/server/analytics-pro.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createReportScheduleCommand, deleteReportScheduleCommand, getEventBySlugQuery, getOrganizationQuery, getReportScheduleQuery, listEventsQuery, listMediaQuery, listMembersQuery, setReportScheduleEnabledCommand, teamEventBySlugQuery, updateReportScheduleCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/analytics/reports/files/[fileId]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/analytics/reports/files/[fileId]/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/analytics/reports/files/[fileId]/route.ts).
- Direct domain imports: @yayatoh/analytics, @yayatoh/kernel, @yayatoh/tenancy.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, reportFileQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/analytics/reports

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/analytics/reports/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/analytics/reports/page.tsx).
- Direct domain imports: @yayatoh/analytics, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/analytics, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [analytics-pro.ts](../../apps/web/src/server/analytics-pro.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createReportScheduleCommand, deleteReportScheduleCommand, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, listMembersQuery, listReportRunsQuery, listReportSchedulesQuery, setReportScheduleEnabledCommand, teamEventBySlugQuery, updateReportScheduleCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/api-keys

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/api-keys/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/api-keys/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/billing, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: createApiKeyCommand, getEventBySlugQuery, getOrganizationQuery, listApiKeysQuery, listMediaQuery, revokeApiKeyCommand, rotateApiKeyCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/api-keys/usage

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/api-keys/usage/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/api-keys/usage/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: apiUsageQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/audiences/[segment]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/audiences/[segment]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/audiences/[segment]/page.tsx).
- Direct domain imports: @yayatoh/audiences, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/attendees, @yayatoh/audiences, @yayatoh/audiences/client, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: audienceExportBulk, creditBalanceQuery, deleteSegmentCommand, getEventBySlugQuery, getOrganizationQuery, getSegmentQuery, listBrandKitsQuery, listEventsQuery, listMediaQuery, listSeriesQuery, listTicketTypesQuery, previewAudienceQuery, saveSegmentCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/audiences/duplicates/[candidate]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/audiences/duplicates/[candidate]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/audiences/duplicates/[candidate]/page.tsx).
- Direct domain imports: @yayatoh/crm, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: dismissDuplicateCommand, duplicatePairQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, mergeContactsCommand, mergeDuplicatesBulkCommand, scanDuplicatesCommand, teamEventBySlugQuery, undoMergeCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/audiences/duplicates

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/audiences/duplicates/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/audiences/duplicates/page.tsx).
- Direct domain imports: @yayatoh/crm, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: dismissDuplicateCommand, duplicateQueueQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, mergeContactsCommand, mergeDuplicatesBulkCommand, scanDuplicatesCommand, teamEventBySlugQuery, undoMergeCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/audiences/exports/[op]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/audiences/exports/[op]/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/audiences/exports/[op]/route.ts).
- Direct domain imports: @yayatoh/audiences, @yayatoh/kernel.
- Connected packages: @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: audienceExportBulk, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/audiences/new

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/audiences/new/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/audiences/new/page.tsx).
- Direct domain imports: @yayatoh/audiences, @yayatoh/audiences/client, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/attendees, @yayatoh/audiences, @yayatoh/audiences/client, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: audienceExportBulk, creditBalanceQuery, deleteSegmentCommand, getEventBySlugQuery, getOrganizationQuery, listBrandKitsQuery, listEventsQuery, listMediaQuery, listSeriesQuery, listTicketTypesQuery, previewAudienceQuery, saveSegmentCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/audiences

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/audiences/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/audiences/page.tsx).
- Direct domain imports: @yayatoh/audiences, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/attendees, @yayatoh/audiences, @yayatoh/audiences/client, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: audienceExportBulk, creditBalanceQuery, deleteSegmentCommand, getEventBySlugQuery, getOrganizationQuery, listBrandKitsQuery, listMediaQuery, listSegmentsQuery, listTicketTypesQuery, previewAudienceQuery, saveSegmentCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/audiences/people/[contact]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/audiences/people/[contact]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/audiences/people/[contact]/page.tsx).
- Direct domain imports: @yayatoh/audiences, @yayatoh/crm, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/audiences, @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: dismissDuplicateCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, mergeContactsCommand, mergeDuplicatesBulkCommand, personQuery, personTimelineQuery, scanDuplicatesCommand, teamEventBySlugQuery, undoMergeCommand.
- Direct guard calls: loadConsole, notFound, redirect.

### web /[locale]/o/[org]/audiences/people

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/audiences/people/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/audiences/people/page.tsx).
- Direct domain imports: @yayatoh/crm, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, peopleQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/brand-kits

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/brand-kits/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/brand-kits/page.tsx).
- Direct domain imports: @yayatoh/ai, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: creditBalanceQuery, deleteBrandKitCommand, getEventBySlugQuery, getOrganizationQuery, listBrandKitsQuery, listMediaQuery, saveBrandKitCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/campaigns/[campaign]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/campaigns/[campaign]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/campaigns/[campaign]/page.tsx).
- Direct domain imports: @yayatoh/audiences, @yayatoh/campaigns, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/attendees, @yayatoh/audiences, @yayatoh/audiences/client, @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/campaigns/client, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/sso, @yayatoh/surveys, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [bulk.ts](../../apps/web/src/server/bulk.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: audienceExportBulk, campaignPreviewQuery, campaignResultsQuery, command, createCampaignCommand, creditBalanceQuery, deleteCampaignCommand, deleteSegmentCommand, estimateReachQuery, getCampaignQuery, getEventBySlugQuery, getOrganizationQuery, listBrandKitsQuery, listEventsQuery, listMediaQuery, listSegmentsQuery, listSeriesQuery, listTicketTypesQuery, previewAudienceQuery, saveCampaignCommand, saveSegmentCommand, scheduleCampaignCommand, sendNowCommand, setAudienceCommand, storeEmailPreviewCommand, teamEventBySlugQuery, testSendCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/campaigns

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/campaigns/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/campaigns/page.tsx).
- Direct domain imports: @yayatoh/campaigns, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/campaigns/client, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: campaignPreviewQuery, command, createCampaignCommand, creditBalanceQuery, deleteCampaignCommand, getEventBySlugQuery, getOrganizationQuery, listBrandKitsQuery, listCampaignsQuery, listMediaQuery, saveCampaignCommand, scheduleCampaignCommand, sendNowCommand, setAudienceCommand, storeEmailPreviewCommand, teamEventBySlugQuery, testSendCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/charity

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/charity/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/charity/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: charityProfileQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, saveCharityProfileCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/command-center

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/command-center/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/command-center/page.tsx).
- Direct domain imports: @yayatoh/command-center, @yayatoh/kernel, @yayatoh/reports, @yayatoh/ui.
- Connected packages: @yayatoh/alerts, @yayatoh/assistance, @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/checkin, @yayatoh/command-center, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [command-center.ts](../../apps/web/src/server/command-center.ts), [conference-sources.ts](../../apps/web/src/server/conference-sources.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: def, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, orgOverviewQuery, reportPresenceCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/contacts/[contact]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/contacts/[contact]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/contacts/[contact]/page.tsx).
- Direct domain imports: @yayatoh/crm, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/crm/client, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: contactStatsQuery, contactValueQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/contacts/stats

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/contacts/stats/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/contacts/stats/page.tsx).
- Direct domain imports: @yayatoh/crm, @yayatoh/crm/client, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/crm/client, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, orgContactStatsQuery, orgValueQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/content/[entry]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/content/[entry]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/content/[entry]/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createEntryCommand, creditBalanceQuery, deleteEntryCommand, getEntryQuery, getEventBySlugQuery, getOrganizationQuery, listBrandKitsQuery, listMediaQuery, setEntryStatusCommand, teamEventBySlugQuery, updateEntryCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/content/contact

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/content/contact/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/content/contact/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: contactPageQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, markContactHandledCommand, orgContactMessagesQuery, setContactPageCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/content/new

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/content/new/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/content/new/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/ai, @yayatoh/ai/ui, @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [ai-compose.ts](../../apps/web/src/server/ai-compose.ts), [ai.ts](../../apps/web/src/server/ai.ts), [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createEntryCommand, creditBalanceQuery, deleteEntryCommand, getEventBySlugQuery, getOrganizationQuery, listBrandKitsQuery, listMediaQuery, setEntryStatusCommand, teamEventBySlugQuery, updateEntryCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/content

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/content/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/content/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listEntriesQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/coupons

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/coupons/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/coupons/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createCouponCommand, getEventBySlugQuery, getOrganizationQuery, listCouponsQuery, listEventsQuery, listMediaQuery, listOrgPromoCodesQuery, setCouponActiveCommand, setPromoCodeActiveCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/disputes

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/disputes/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/disputes/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: disputeQueueQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/domains

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/domains/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/domains/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [domains.ts](../../apps/web/src/server/domains.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: acceptAgreementCommand, addDomainCommand, ensureManagedDomainCommand, getEventBySlugQuery, getOrganizationQuery, listDomainsQuery, listMediaQuery, payoutAccountIdQuery, payoutAccountQuery, recordDomainCheckCommand, recordDomainWalletsCommand, removeDomainCommand, setLegalPageCommand, setPrimaryDomainCommand, teamEventBySlugQuery, updateOrganizationCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/emails

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/emails/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/emails/page.tsx).
- Direct domain imports: @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, previewTemplateQuery, setTemplateOverrideCommand, storeEmailPreviewCommand, teamEventBySlugQuery, templateOverridesQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/events/new/guided

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/events/new/guided/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/events/new/guided/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/venues.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/command-center/client, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/profiles, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui, @yayatoh/venues.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [profile-picker.ts](../../apps/web/src/server/profile-picker.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: IDEMPOTENT_CREATE, IDEMPOTENT_CREATE_IN_SERIES, createEventCommand, createEventInSeriesCommand, createTicketTypeCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listSeriesQuery, listTicketTypesQuery, listVenuesQuery, setEventDetailsCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/events/new

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/events/new/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/events/new/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/profiles, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [profile-picker.ts](../../apps/web/src/server/profile-picker.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: IDEMPOTENT_CREATE, IDEMPOTENT_CREATE_IN_SERIES, createEventCommand, createEventInSeriesCommand, createTicketTypeCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listSeriesQuery, listTicketTypesQuery, setEventDetailsCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/fees

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/fees/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/fees/page.tsx).
- Direct domain imports: @yayatoh/billing, @yayatoh/kernel, @yayatoh/reports, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: feeScheduleQuery, feesReportQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, planSummaryQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/finance

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/finance/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/finance/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/payments, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: creditNoteTotalsQuery, creditNotesQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, reconciliationItemsQuery, reconciliationRunsQuery, resolveReconciliationItemCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/help-center/[article]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/help-center/[article]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/help-center/[article]/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: createHelpArticleCommand, createHelpCategoryCommand, deleteHelpArticleCommand, deleteHelpCategoryCommand, getEventBySlugQuery, getHelpArticleQuery, getOrganizationQuery, listHelpQuery, listMediaQuery, setHelpArticleStatusCommand, teamEventBySlugQuery, updateHelpArticleCommand, updateHelpCategoryCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/help-center/categories/[category]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/help-center/categories/[category]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/help-center/categories/[category]/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createHelpArticleCommand, createHelpCategoryCommand, deleteHelpArticleCommand, deleteHelpCategoryCommand, getEventBySlugQuery, getHelpCategoryQuery, getOrganizationQuery, listMediaQuery, setHelpArticleStatusCommand, teamEventBySlugQuery, updateHelpArticleCommand, updateHelpCategoryCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/help-center/new

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/help-center/new/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/help-center/new/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createHelpArticleCommand, createHelpCategoryCommand, deleteHelpArticleCommand, deleteHelpCategoryCommand, getEventBySlugQuery, getOrganizationQuery, listHelpQuery, listMediaQuery, setHelpArticleStatusCommand, teamEventBySlugQuery, updateHelpArticleCommand, updateHelpCategoryCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/help-center

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/help-center/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/help-center/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createHelpArticleCommand, createHelpCategoryCommand, deleteHelpArticleCommand, deleteHelpCategoryCommand, getEventBySlugQuery, getOrganizationQuery, listHelpQuery, listMediaQuery, setHelpArticleStatusCommand, teamEventBySlugQuery, updateHelpArticleCommand, updateHelpCategoryCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/integrations/[connection]/import

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/integrations/[connection]/import/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/integrations/[connection]/import/page.tsx).
- Direct domain imports: @yayatoh/integrations, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/integrations, @yayatoh/integrations/client, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: connectionDetailQuery, getEventBySlugQuery, getOrganizationQuery, importResultQuery, listMediaQuery, openErrorCountQuery, requestSyncCommand, teamEventBySlugQuery, unlinkSheetCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/integrations/[connection]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/integrations/[connection]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/integrations/[connection]/page.tsx).
- Direct domain imports: @yayatoh/integrations, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/audiences, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/integrations, @yayatoh/integrations/client, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: accountingDetailQuery, audienceSyncQuery, beginConnectCommand, completeConnectCommand, connectionDetailQuery, consentChangesQuery, disconnectCommand, dismissErrorsCommand, failConnectCommand, getEventBySlugQuery, getOrganizationQuery, linkedCountsQuery, listEventsQuery, listMediaQuery, listSegmentsQuery, openErrorCountQuery, queueSlackTestCommand, requestSyncCommand, retryErrorsCommand, saveAccountMapCommand, saveAudienceSyncCommand, saveMappingCommand, saveSlackSettingsCommand, setConnectionPausedCommand, setSyncIntervalCommand, sheetLinksQuery, slackPanelQuery, teamEventBySlugQuery, unlinkSheetCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/integrations/callback

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/integrations/callback/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/integrations/callback/route.ts).
- Direct domain imports: @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: completeConnectCommand, failConnectCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, pendingConnectionQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/integrations/errors

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/integrations/errors/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/integrations/errors/page.tsx).
- Direct domain imports: @yayatoh/integrations, @yayatoh/integrations/client, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/integrations, @yayatoh/integrations/client, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: beginConnectCommand, completeConnectCommand, connectionDetailQuery, disconnectCommand, dismissErrorsCommand, failConnectCommand, getEventBySlugQuery, getOrganizationQuery, listErrorGroupsQuery, listMediaQuery, openErrorCountQuery, requestSyncCommand, retryErrorsCommand, saveAccountMapCommand, saveMappingCommand, setConnectionPausedCommand, setSyncIntervalCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/integrations

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/integrations/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/integrations/page.tsx).
- Direct domain imports: @yayatoh/integrations, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/integrations, @yayatoh/integrations/client, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: beginConnectCommand, completeConnectCommand, connectionDetailQuery, disconnectCommand, dismissErrorsCommand, failConnectCommand, getEventBySlugQuery, getOrganizationQuery, listConnectionsQuery, listMediaQuery, openErrorCountQuery, requestSyncCommand, retryErrorsCommand, saveAccountMapCommand, saveMappingCommand, setConnectionPausedCommand, setSyncIntervalCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/integrations/zapier

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/integrations/zapier/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/integrations/zapier/page.tsx).
- Direct domain imports: @yayatoh/integrations, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/webhooks.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/integrations, @yayatoh/integrations/client, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/webhooks.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listApiKeysQuery, listMediaQuery, listRestHooksQuery, openErrorCountQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/journeys/[journey]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/journeys/[journey]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/journeys/[journey]/page.tsx).
- Direct domain imports: @yayatoh/automations, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/automations, @yayatoh/automations/client, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createJourneyCommand, deleteJourneyCommand, getEventBySlugQuery, getOrganizationQuery, journeyQuery, journeyRunsQuery, listMediaQuery, listSeriesQuery, setJourneyEnabledCommand, teamEventBySlugQuery, updateJourneyCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/journeys/[journey]/runs/[run]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/journeys/[journey]/runs/[run]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/journeys/[journey]/runs/[run]/page.tsx).
- Direct domain imports: @yayatoh/automations, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/automations, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, journeyQuery, journeyRunQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/journeys/new

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/journeys/new/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/journeys/new/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/automations, @yayatoh/automations/client, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createJourneyCommand, deleteJourneyCommand, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, listSeriesQuery, setJourneyEnabledCommand, teamEventBySlugQuery, updateJourneyCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/journeys

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/journeys/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/journeys/page.tsx).
- Direct domain imports: @yayatoh/automations, @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/automations, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listJourneysQuery, listMediaQuery, listSeriesQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/macros

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/macros/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/macros/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: archiveSupportMacroCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, saveSupportMacroCommand, supportMacrosQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/marketing-analytics/campaign

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/marketing-analytics/campaign/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/marketing-analytics/campaign/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/marketing, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [campaign-names.ts](../../apps/web/src/server/campaign-names.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: campaignDetailQuery, campaignNamesQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/marketing-analytics/deliverability

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/marketing-analytics/deliverability/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/marketing-analytics/deliverability/page.tsx).
- Direct domain imports: @yayatoh/alerts, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/alerts, @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [campaign-names.ts](../../apps/web/src/server/campaign-names.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: campaignNamesQuery, deliverabilityReportQuery, getEventBySlugQuery, getOrganizationQuery, listAlertsQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/marketing-analytics/export

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/marketing-analytics/export/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/marketing-analytics/export/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/marketing, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [campaign-names.ts](../../apps/web/src/server/campaign-names.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: analyticsReportQuery, campaignNamesQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/marketing-analytics

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/marketing-analytics/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/marketing-analytics/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/marketing, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/campaigns, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [campaign-names.ts](../../apps/web/src/server/campaign-names.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: analyticsReportQuery, campaignNamesQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/marketing/[section]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/marketing/[section]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/marketing/[section]/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createSiteSectionCommand, deleteSiteSectionCommand, getEventBySlugQuery, getOrganizationQuery, getSiteSectionQuery, listMediaQuery, markContactHandledCommand, setSiteSectionStatusCommand, teamEventBySlugQuery, updateSiteSectionCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/marketing/new

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/marketing/new/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/marketing/new/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/contracts, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createSiteSectionCommand, deleteSiteSectionCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, markContactHandledCommand, setSiteSectionStatusCommand, teamEventBySlugQuery, updateSiteSectionCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/marketing

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/marketing/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/marketing/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createSiteSectionCommand, deleteSiteSectionCommand, getEventBySlugQuery, getOrganizationQuery, listContactRequestsQuery, listMediaQuery, listSiteSectionsQuery, markContactHandledCommand, setSiteSectionStatusCommand, teamEventBySlugQuery, updateSiteSectionCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/media

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/media/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/media/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/media, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: family, getEventBySlugQuery, getOrganizationQuery, libraryQuery, listMediaQuery, listOwnersMediaQuery, storageUsageQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/messages/[threadId]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/messages/[threadId]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/messages/[threadId]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/messaging, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/messaging, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: blockThreadCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, markThreadReadCommand, replyToThreadCommand, reportThreadCommand, teamEventBySlugQuery, threadQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/messages

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/messages/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/messages/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/messaging, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/messaging, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery, threadsQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/messaging

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/messaging/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/messaging/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addressSuppressionsQuery, autoPauseQuery, frequencyCapsQuery, getEventBySlugQuery, getOrganizationQuery, liftAddressSuppressionCommand, listMediaQuery, messagingUsageQuery, policyLogQuery, setFrequencyCapsCommand, suspensionsQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/money/export

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/money/export/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/money/export/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: eventMoneyQuery, feesReportQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, moneyOverviewQuery, orgReportQuery, payoutDetailQuery, payoutsDashboardQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/money

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/money/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/money/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, moneyOverviewQuery, payoutsDashboardQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/notifications

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/notifications/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/notifications/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [inbox.ts](../../apps/web/src/server/inbox.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, inboxQuery, listMediaQuery, markInboxReadCommand, myPushDevicesQuery, registerPushTokenCommand, removePushTokenCommand, sendTestNotificationCommand, setMyPreferencesCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/notifications/preferences

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/notifications/preferences/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/notifications/preferences/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [inbox.ts](../../apps/web/src/server/inbox.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: acceptAgreementCommand, getEventBySlugQuery, getOrganizationQuery, inboxQuery, listMediaQuery, markInboxReadCommand, myPreferencesQuery, myPushDevicesQuery, registerPushTokenCommand, removePushTokenCommand, sendTestNotificationCommand, setLegalPageCommand, setMyPreferencesCommand, teamEventBySlugQuery, updateOrganizationCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/payments, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: completeOnboardingCommand, getEventBySlugQuery, getOrganizationQuery, legalPagesQuery, listEventsQuery, listInvitationsQuery, listMediaQuery, listMembersQuery, listSeriesQuery, myTeamEventsQuery, onboardingQuery, orgCategoriesQuery, orgFinanceQuery, orgReportQuery, orgTagsQuery, payoutAccountQuery, searchEventsQuery, sellsPaidTicketsQuery, suspensionsQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, loadConsoleBase.

### web /[locale]/o/[org]/payouts/[settlement]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/payouts/[settlement]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/payouts/[settlement]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, payoutDetailQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/payouts

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/payouts/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/payouts/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/payments, @yayatoh/reports, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: continuePayoutOnboardingCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, payoutAccountQuery, payoutsDashboardQuery, recordPayoutAccountCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/plan

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/plan/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/plan/page.tsx).
- Direct domain imports: @yayatoh/billing, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [billing.ts](../../apps/web/src/server/billing.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: billingStandingQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, planChangeOptionsQuery, planSummaryQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/plan/usage

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/plan/usage/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/plan/usage/page.tsx).
- Direct domain imports: @yayatoh/billing, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery, usageSummaryQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/privacy

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/privacy/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/privacy/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/privacy, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/privacy, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [privacy-request.ts](../../apps/web/src/server/privacy-request.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: cancelRequestCommand, eraseSubjectCommand, exportSubjectCommand, findSubjectQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, openRequestCommand, requestsQuery, selfArchiveFileQuery, selfReceiptQuery, submitSelfRequestCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/privacy/requests/[id]/archive

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/privacy/requests/[id]/archive/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/privacy/requests/[id]/archive/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/privacy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/privacy, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [dsar-receipt.ts](../../apps/web/src/server/dsar-receipt.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: archiveFileQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/privacy/requests/[id]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/privacy/requests/[id]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/privacy/requests/[id]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/privacy, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/privacy, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [privacy-request.ts](../../apps/web/src/server/privacy-request.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: cancelRequestCommand, eraseSubjectCommand, exportSubjectCommand, findSubjectQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, openRequestCommand, requestQuery, selfArchiveFileQuery, selfReceiptQuery, submitSelfRequestCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/privacy/requests/[id]/receipt

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/privacy/requests/[id]/receipt/route.ts](../../apps/web/src/app/[locale]/o/[org]/(org)/privacy/requests/[id]/receipt/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/privacy.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/privacy, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [dsar-receipt.ts](../../apps/web/src/server/dsar-receipt.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, requestQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/promotions

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/promotions/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/promotions/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: endPromotionCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, promoteListingCommand, promotionsQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/refund-requests

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/refund-requests/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/refund-requests/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, refundRequestCountsQuery, refundRequestsQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/sales-by-event

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/sales-by-event/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/sales-by-event/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/reports, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: eventMoneyQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, orgReportQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/sandboxes

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/sandboxes/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/sandboxes/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sandbox.ts](../../apps/web/src/server/sandbox.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: createEventCommand, createTicketTypeCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listSandboxesQuery, teamEventBySlugQuery, transitionEventCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/search

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/search/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/search/page.tsx).
- Direct domain imports: @yayatoh/attendees, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/attendees, @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: findTicketsByCodeQuery, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, searchAttendeesQuery, searchOrdersQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/seating-library

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/seating-library/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/seating-library/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: IDEMPOTENT_CREATE, addVenuePartnerCommand, createEventCommand, deleteLayoutCommand, getEventBySlugQuery, getEventQuery, getOrganizationQuery, layoutLibraryQuery, listEventsQuery, listMediaQuery, removeVenuePartnerCommand, renameLayoutCommand, setEventLayoutCommand, shared, sharedLayoutsQuery, teamEventBySlugQuery, useSharedLayoutCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/sending

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/sending/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/sending/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addSendingDomainCommand, emailIdentityQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, recordSendingDomainCheckCommand, removeSendingDomainCommand, sendingSetupQuery, setEmailIdentityCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/series/[series]/details

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/series/[series]/details/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/series/[series]/details/page.tsx).
- Direct domain imports: @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: deleteSeriesCommand, duplicateEventCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, seriesDetailQuery, setEventSeriesCommand, teamEventBySlugQuery, updateSeriesCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/series/[series]/next

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/series/[series]/next/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/series/[series]/next/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: deleteSeriesCommand, duplicateEventCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, seriesDetailQuery, setEventSeriesCommand, teamEventBySlugQuery, updateSeriesCommand.
- Direct guard calls: notFound.

### web /[locale]/o/[org]/series/[series]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/series/[series]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/series/[series]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/reports, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/sso, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: deleteSeriesCommand, duplicateEventCommand, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, listSeriesQuery, orgReportQuery, seriesDetailQuery, setEventSeriesCommand, teamEventBySlugQuery, updateSeriesCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o/[org]/series

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/series/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/series/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createSeriesCommand, deleteSeriesCommand, getEventBySlugQuery, getOrganizationQuery, listEventsQuery, listMediaQuery, listSeriesQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/settings/categories

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/settings/categories/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/settings/categories/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addOrgCategoryCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, moveOrgCategoryCommand, orgCategoriesQuery, renameOrgCategoryCommand, setOrgCategoryHiddenCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/settings

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/settings/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/settings/page.tsx).
- Direct domain imports: @yayatoh/contracts, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: acceptAgreementCommand, agreementsQuery, family, getEventBySlugQuery, getOrganizationQuery, legalPagesQuery, libraryQuery, listMediaQuery, listOwnersMediaQuery, setLegalPageCommand, teamEventBySlugQuery, updateOrganizationCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/site

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/site/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/site/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: acceptAgreementCommand, getEventBySlugQuery, getOrganizationQuery, listEntriesQuery, listEventsQuery, listMediaQuery, setLegalPageCommand, siteSettingsQuery, teamEventBySlugQuery, updateOrganizationCommand, updateSiteSettingsCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/sso

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/sso/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/sso/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [sso.ts](../../apps/web/src/server/sso.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: addDomainCommand, checkDomainCommand, completeSsoLoginCommand, createScimTokenCommand, deleteConnectionCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, recordConnectionTestCommand, removeDomainCommand, revokeScimTokenCommand, saveConnectionCommand, setConnectionStatusCommand, setDomainEnforcementCommand, setGroupRoleCommand, ssoSettingsQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/storage

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/storage/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/storage/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/media, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, libraryQuery, listMediaQuery, listOwnersMediaQuery, storageUsageQuery, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/team

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/team/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/team/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: changeMemberRoleCommand, getEventBySlugQuery, getOrganizationQuery, inviteMemberCommand, listInvitationsQuery, listMediaQuery, listMembersQuery, removeMemberCommand, revokeInvitationCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/templates/[template]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/templates/[template]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/templates/[template]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [section-content.ts](../../apps/web/src/server/section-content.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addTemplateChecklistItemCommand, addTemplateSectionCommand, addTemplateTicketTypeCommand, copyStarterCommand, createEventCommand, createEventTemplateCommand, createFromTemplateCommand, deleteTemplateCommand, duplicateEventCommand, duplicateTemplateCommand, getEventBySlugQuery, getOrganizationQuery, getTemplateQuery, listMediaQuery, moveTemplateSectionCommand, removeTemplateChecklistItemCommand, removeTemplateSectionCommand, removeTemplateTicketTypeCommand, saveTemplateCommand, setTemplateArchivedCommand, teamEventBySlugQuery, updateTemplateCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/templates/new

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/templates/new/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/templates/new/page.tsx).
- Direct domain imports: @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: copyStarterCommand, createEventCommand, createEventTemplateCommand, createFromTemplateCommand, deleteTemplateCommand, duplicateEventCommand, duplicateTemplateCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, saveTemplateCommand, setTemplateArchivedCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/templates

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/templates/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/templates/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/templates, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: copyStarterCommand, createEventCommand, createEventTemplateCommand, createFromTemplateCommand, deleteTemplateCommand, duplicateEventCommand, duplicateTemplateCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, listTemplatesQuery, saveTemplateCommand, setTemplateArchivedCommand, teamEventBySlugQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/venue-portal

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/venue-portal/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/venue-portal/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: IDEMPOTENT_CREATE, addVenuePartnerCommand, createEventCommand, deleteLayoutCommand, getEventBySlugQuery, getEventQuery, getOrganizationQuery, listMediaQuery, removeVenuePartnerCommand, renameLayoutCommand, setEventLayoutCommand, shared, teamEventBySlugQuery, useSharedLayoutCommand, venuePortalQuery.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/venues/[venue]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/venues/[venue]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/venues/[venue]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/venues.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/venues.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createVenueCommand, family, getEventBySlugQuery, getOrganizationQuery, getVenueQuery, libraryQuery, listMediaQuery, listOwnersMediaQuery, listQuoteRequestsQuery, setQuoteRequestStatusCommand, setVenueArchivedCommand, teamEventBySlugQuery, updateVenueCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/venues

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/venues/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/venues/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/venues.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/venues.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [media.ts](../../apps/web/src/server/media.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createVenueCommand, getEventBySlugQuery, getOrganizationQuery, libraryQuery, listMediaQuery, listOwnersMediaQuery, listVenuesQuery, setQuoteRequestStatusCommand, setVenueArchivedCommand, teamEventBySlugQuery, updateVenueCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/webhooks/[endpoint]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/webhooks/[endpoint]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/webhooks/[endpoint]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/webhooks.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/webhooks.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts).
- Operations in local dependency chain: createEndpointCommand, deleteEndpointCommand, endpointAttemptsQuery, getEndpointQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, recoverFailedCommand, resendMessageCommand, revealEndpointSecretCommand, rotateEndpointSecretCommand, sendTestCommand, teamEventBySlugQuery, updateEndpointCommand.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/webhooks

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/webhooks/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/webhooks/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/webhooks.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/webhooks.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createEndpointCommand, deleteEndpointCommand, getEventBySlugQuery, getOrganizationQuery, listEndpointsQuery, listMediaQuery, recoverFailedCommand, resendMessageCommand, revealEndpointSecretCommand, rotateEndpointSecretCommand, sendTestCommand, teamEventBySlugQuery, updateEndpointCommand.
- Direct guard calls: loadConsole.

### web /[locale]/o/[org]/webhooks/portal

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/(org)/webhooks/portal/page.tsx](../../apps/web/src/app/[locale]/o/[org]/(org)/webhooks/portal/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/webhooks.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/webhooks.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: createEndpointCommand, deleteEndpointCommand, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, recoverFailedCommand, resendMessageCommand, revealEndpointSecretCommand, rotateEndpointSecretCommand, sendTestCommand, teamEventBySlugQuery, updateEndpointCommand, webhookPortalQuery.
- Direct guard calls: loadConsole, notFound.

### web /[locale]/o/[org]/seat-poster/[event]

- Type: page.
- Source: [apps/web/src/app/[locale]/o/[org]/seat-poster/[event]/page.tsx](../../apps/web/src/app/[locale]/o/[org]/seat-poster/[event]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: finderPosterQuery, getEventBySlugQuery, getOrganizationQuery, listMediaQuery, teamEventBySlugQuery.
- Direct guard calls: loadEvent, notFound.

## participant portals

### web /[locale]/events/[slug]/exhibitors

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/exhibitors/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/exhibitors/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/floorplan, @yayatoh/media, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/ui.
- Server files: [exhibitor-map.ts](../../apps/web/src/server/exhibitor-map.ts), [locale.ts](../../apps/web/src/server/locale.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/events/[slug]/speakers/[speaker]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/speakers/[speaker]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/speakers/[speaker]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/media, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/ui.
- Server files: [locale.ts](../../apps/web/src/server/locale.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/portal/[event]

- Type: page.
- Source: [apps/web/src/app/[locale]/portal/[event]/page.tsx](../../apps/web/src/app/[locale]/portal/[event]/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Server files: [demo.ts](../../apps/web/src/server/demo.ts), [dev.ts](../../apps/web/src/server/dev.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/events/[slug]/speakers/[speaker]

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/events/[slug]/speakers/[speaker]/page.tsx](../../apps/web/src/app/[locale]/t/[org]/events/[slug]/speakers/[speaker]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/media, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/ui.
- Server files: [locale.ts](../../apps/web/src/server/locale.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

## platform administration

### admin /access-log

- Type: page.
- Source: [apps/admin/src/app/access-log/page.tsx](../../apps/admin/src/app/access-log/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [tenants.ts](../../apps/admin/src/server/tenants.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /categories

- Type: page.
- Source: [apps/admin/src/app/categories/page.tsx](../../apps/admin/src/app/categories/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [platform-categories.ts](../../apps/admin/src/server/platform-categories.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /charities/[orgId]

- Type: page.
- Source: [apps/admin/src/app/charities/[orgId]/page.tsx](../../apps/admin/src/app/charities/[orgId]/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/donations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [charities.ts](../../apps/admin/src/server/charities.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [ports.ts](../../apps/admin/src/server/ports.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: rejectCharityCommand, verifyCharityCommand.
- Direct guard calls: notFound, requireStaff.

### admin /charities

- Type: page.
- Source: [apps/admin/src/app/charities/page.tsx](../../apps/admin/src/app/charities/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/donations, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [charities.ts](../../apps/admin/src/server/charities.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /commission

- Type: page.
- Source: [apps/admin/src/app/commission/page.tsx](../../apps/admin/src/app/commission/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [reports.ts](../../apps/admin/src/server/reports.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /front-door

- Type: page.
- Source: [apps/admin/src/app/front-door/page.tsx](../../apps/admin/src/app/front-door/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/platform/front-door, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/front-door, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [front-door-store.ts](../../apps/admin/src/server/front-door-store.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /incidents

- Type: page.
- Source: [apps/admin/src/app/incidents/page.tsx](../../apps/admin/src/app/incidents/page.tsx).
- Direct domain imports: @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [incidents.ts](../../apps/admin/src/server/incidents.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /listings

- Type: page.
- Source: [apps/admin/src/app/listings/page.tsx](../../apps/admin/src/app/listings/page.tsx).
- Direct domain imports: @yayatoh/marketplace, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [listings.ts](../../apps/admin/src/server/listings.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [ports.ts](../../apps/admin/src/server/ports.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: moderateListingCommand.
- Direct guard calls: requireStaff.

### admin /maintenance

- Type: page.
- Source: [apps/admin/src/app/maintenance/page.tsx](../../apps/admin/src/app/maintenance/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [maintenance.ts](../../apps/admin/src/server/maintenance.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /messaging

- Type: page.
- Source: [apps/admin/src/app/messaging/page.tsx](../../apps/admin/src/app/messaging/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /not-staff

- Type: page.
- Source: [apps/admin/src/app/not-staff/page.tsx](../../apps/admin/src/app/not-staff/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth/client, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### admin /open-signup

- Type: page.
- Source: [apps/admin/src/app/open-signup/page.tsx](../../apps/admin/src/app/open-signup/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [open-signup.ts](../../apps/admin/src/server/open-signup.ts), [signup-codes.ts](../../apps/admin/src/server/signup-codes.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /

- Type: page.
- Source: [apps/admin/src/app/page.tsx](../../apps/admin/src/app/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [tenants.ts](../../apps/admin/src/server/tenants.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /people

- Type: page.
- Source: [apps/admin/src/app/people/page.tsx](../../apps/admin/src/app/people/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/privacy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [people.ts](../../apps/admin/src/server/people.ts), [ports.ts](../../apps/admin/src/server/ports.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /providers

- Type: page.
- Source: [apps/admin/src/app/providers/page.tsx](../../apps/admin/src/app/providers/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [providers.ts](../../apps/admin/src/server/providers.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /reports

- Type: page.
- Source: [apps/admin/src/app/reports/page.tsx](../../apps/admin/src/app/reports/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/engagement, @yayatoh/kernel, @yayatoh/messaging, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [chat-reports.ts](../../apps/admin/src/server/chat-reports.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [messaging-reports.ts](../../apps/admin/src/server/messaging-reports.ts), [ports.ts](../../apps/admin/src/server/ports.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: reviewChatReportCommand, reviewReportCommand.
- Direct guard calls: requireStaff.

### admin /security

- Type: page.
- Source: [apps/admin/src/app/security/page.tsx](../../apps/admin/src/app/security/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/auth/passkey-client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /sign-in

- Type: page.
- Source: [apps/admin/src/app/sign-in/page.tsx](../../apps/admin/src/app/sign-in/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/auth/passkey-client, @yayatoh/platform, @yayatoh/ui.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### admin /signup-codes

- Type: page.
- Source: [apps/admin/src/app/signup-codes/page.tsx](../../apps/admin/src/app/signup-codes/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [signup-codes.ts](../../apps/admin/src/server/signup-codes.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireStaff.

### admin /tenants/[id]/disputes/[disputeId]/evidence

- Type: endpoint (GET).
- Source: [apps/admin/src/app/tenants/[id]/disputes/[disputeId]/evidence/route.ts](../../apps/admin/src/app/tenants/[id]/disputes/[disputeId]/evidence/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/pdf, @yayatoh/reports.
- Connected packages: @yayatoh/auth, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/reports.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [payments.ts](../../apps/admin/src/server/payments.ts), [ports.ts](../../apps/admin/src/server/ports.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts).
- Operations in local dependency chain: disputeEvidencePacketQuery.
- Direct guard calls: requireStaff.

### admin /tenants/[id]/messaging

- Type: page.
- Source: [apps/admin/src/app/tenants/[id]/messaging/page.tsx](../../apps/admin/src/app/tenants/[id]/messaging/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [ports.ts](../../apps/admin/src/server/ports.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: autoPauseQuery, getOrganizationQuery, liftAutoPauseCommand, messagingUsageQuery, sendingSetupQuery, setChannelSenderCommand, setQuotaLimitCommand.
- Direct guard calls: notFound, requireStaff.

### admin /tenants/[id]

- Type: page.
- Source: [apps/admin/src/app/tenants/[id]/page.tsx](../../apps/admin/src/app/tenants/[id]/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/billing, @yayatoh/kernel, @yayatoh/payments, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/billing, @yayatoh/db/platform, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/admin/src/server/auth.ts), [messaging-policy.ts](../../apps/admin/src/server/messaging-policy.ts), [payments.ts](../../apps/admin/src/server/payments.ts), [ports.ts](../../apps/admin/src/server/ports.ts), [staff-roles.ts](../../apps/admin/src/server/staff-roles.ts), [staff.ts](../../apps/admin/src/server/staff.ts), [theme-actions.ts](../../apps/admin/src/server/theme-actions.ts), [theme.ts](../../apps/admin/src/server/theme.ts).
- Operations in local dependency chain: disputesQuery, endImpersonationCommand, feeScheduleQuery, getEntitlementsQuery, getOrganizationQuery, ledgerBalancesQuery, listDomainsQuery, listMembersQuery, markEvidenceSubmittedCommand, orgStatusHistoryQuery, payoutAccountQuery, reconciliationItemsQuery, resolveReconciliationItemCommand, restoreOrgCommand, setEntitlementOverrideCommand, setFeeOverrideCommand, setOrgStatusCommand, setPayoutHoldCommand, setSuspensionCommand, startImpersonationCommand, suspensionHistoryQuery.
- Direct guard calls: notFound, requireStaff.

## public and account

### web /[locale]/account/deleted

- Type: page.
- Source: [apps/web/src/app/[locale]/account/deleted/page.tsx](../../apps/web/src/app/[locale]/account/deleted/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/account/security

- Type: page.
- Source: [apps/web/src/app/[locale]/account/security/page.tsx](../../apps/web/src/app/[locale]/account/security/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/privacy, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/totp, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/privacy, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [account.ts](../../apps/web/src/server/account.ts), [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session-actions.ts](../../apps/web/src/server/session-actions.ts), [session.ts](../../apps/web/src/server/session.ts), [social.ts](../../apps/web/src/server/social.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [step-up-actions.ts](../../apps/web/src/server/step-up-actions.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: endImpersonationCommand.
- Direct guard calls: redirect.

### web /[locale]/auth/error

- Type: page.
- Source: [apps/web/src/app/[locale]/auth/error/page.tsx](../../apps/web/src/app/[locale]/auth/error/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/auth/handoff

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/auth/handoff/route.ts](../../apps/web/src/app/[locale]/auth/handoff/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /[locale]/auth/sign-out

- Type: endpoint (POST).
- Source: [apps/web/src/app/[locale]/auth/sign-out/route.ts](../../apps/web/src/app/[locale]/auth/sign-out/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /[locale]/auth/social/[provider]/callback

- Type: endpoint (GET, POST).
- Source: [apps/web/src/app/[locale]/auth/social/[provider]/callback/route.ts](../../apps/web/src/app/[locale]/auth/social/[provider]/callback/route.ts).
- Direct domain imports: @yayatoh/auth.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sign-in-finish.ts](../../apps/web/src/server/sign-in-finish.ts), [social.ts](../../apps/web/src/server/social.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /[locale]/auth/social/[provider]/start

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/auth/social/[provider]/start/route.ts](../../apps/web/src/app/[locale]/auth/social/[provider]/start/route.ts).
- Direct domain imports: @yayatoh/auth.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [sign-in-finish.ts](../../apps/web/src/server/sign-in-finish.ts), [social.ts](../../apps/web/src/server/social.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /[locale]/auth/social/fake/answer

- Type: endpoint (POST).
- Source: [apps/web/src/app/[locale]/auth/social/fake/answer/route.ts](../../apps/web/src/app/[locale]/auth/social/fake/answer/route.ts).
- Direct domain imports: @yayatoh/auth.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [social.ts](../../apps/web/src/server/social.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /[locale]/auth/social/fake

- Type: page.
- Source: [apps/web/src/app/[locale]/auth/social/fake/page.tsx](../../apps/web/src/app/[locale]/auth/social/fake/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [ports.ts](../../apps/web/src/server/ports.ts), [social.ts](../../apps/web/src/server/social.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/auth/sso/callback

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/auth/sso/callback/route.ts](../../apps/web/src/app/[locale]/auth/sso/callback/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-finish.ts](../../apps/web/src/server/sso-finish.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [sso.ts](../../apps/web/src/server/sso.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: completeSsoLoginCommand, recordConnectionTestCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/auth/sso/fake

- Type: page.
- Source: [apps/web/src/app/[locale]/auth/sso/fake/page.tsx](../../apps/web/src/app/[locale]/auth/sso/fake/page.tsx).
- Direct domain imports: @yayatoh/sso, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [sso.ts](../../apps/web/src/server/sso.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: completeSsoLoginCommand.
- Direct guard calls: notFound.

### web /[locale]/auth/sso/saml/acs

- Type: endpoint (POST).
- Source: [apps/web/src/app/[locale]/auth/sso/saml/acs/route.ts](../../apps/web/src/app/[locale]/auth/sso/saml/acs/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-finish.ts](../../apps/web/src/server/sso-finish.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [sso.ts](../../apps/web/src/server/sso.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: completeSsoLoginCommand, recordConnectionTestCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/auth/sso/saml/metadata

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/auth/sso/saml/metadata/route.ts](../../apps/web/src/app/[locale]/auth/sso/saml/metadata/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [sso.ts](../../apps/web/src/server/sso.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: completeSsoLoginCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/auth/start

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/auth/start/route.ts](../../apps/web/src/app/[locale]/auth/start/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/contracts.
- Server files: [request-origin.ts](../../apps/web/src/server/request-origin.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /[locale]/billing/fake

- Type: page.
- Source: [apps/web/src/app/[locale]/billing/fake/page.tsx](../../apps/web/src/app/[locale]/billing/fake/page.tsx).
- Direct domain imports: @yayatoh/billing, @yayatoh/ui.
- Connected packages: @yayatoh/billing, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [billing.ts](../../apps/web/src/server/billing.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/blogs/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/blogs/[slug]/page.tsx](../../apps/web/src/app/[locale]/blogs/[slug]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/blogs

- Type: page.
- Source: [apps/web/src/app/[locale]/blogs/page.tsx](../../apps/web/src/app/[locale]/blogs/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/certificates/[org]/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/certificates/[org]/[token]/route.ts](../../apps/web/src/app/[locale]/certificates/[org]/[token]/route.ts).
- Direct domain imports: @yayatoh/ce.
- Connected packages: @yayatoh/ce, @yayatoh/contracts, @yayatoh/pdf, @yayatoh/tenancy.
- Server files: [pdf.ts](../../apps/web/src/server/pdf.ts), [receipt-pdf.ts](../../apps/web/src/server/receipt-pdf.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/certificates/[org]/verify/[code]

- Type: page.
- Source: [apps/web/src/app/[locale]/certificates/[org]/verify/[code]/page.tsx](../../apps/web/src/app/[locale]/certificates/[org]/verify/[code]/page.tsx).
- Direct domain imports: @yayatoh/ce, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/ce, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [locale.ts](../../apps/web/src/server/locale.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: verifyCertificateQuery.
- Direct guard calls: notFound.

### web /[locale]/certificates/[org]/verify

- Type: page.
- Source: [apps/web/src/app/[locale]/certificates/[org]/verify/page.tsx](../../apps/web/src/app/[locale]/certificates/[org]/verify/page.tsx).
- Direct domain imports: @yayatoh/ce, @yayatoh/ui.
- Connected packages: @yayatoh/ce, @yayatoh/contracts, @yayatoh/ui.
- Server files: [locale.ts](../../apps/web/src/server/locale.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound, redirect.

### web /[locale]/claim/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/claim/[token]/page.tsx](../../apps/web/src/app/[locale]/claim/[token]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/kernel, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: claimDetailsQuery, claimTicketCommand.
- Direct guard calls: notFound.

### web /[locale]/collect/[code]

- Type: page.
- Source: [apps/web/src/app/[locale]/collect/[code]/page.tsx](../../apps/web/src/app/[locale]/collect/[code]/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: publicCollectorQuery, submitContactCommand.
- Direct guard calls: notFound.

### web /[locale]/connect/fake

- Type: page.
- Source: [apps/web/src/app/[locale]/connect/fake/page.tsx](../../apps/web/src/app/[locale]/connect/fake/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/kernel, @yayatoh/payments, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/contact

- Type: page.
- Source: [apps/web/src/app/[locale]/contact/page.tsx](../../apps/web/src/app/[locale]/contact/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [help.ts](../../apps/web/src/server/help.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seat-finder.ts](../../apps/web/src/server/seat-finder.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: publicVenueMapQuery, submitContactRequestCommand.
- Direct guard calls: notFound.

### web /[locale]/developers/events

- Type: page.
- Source: [apps/web/src/app/[locale]/developers/events/page.tsx](../../apps/web/src/app/[locale]/developers/events/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/api-v1, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/payments, @yayatoh/sdk, @yayatoh/ui, @yayatoh/webhooks/catalog, @yayatoh/webhooks/examples.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [developer-docs.ts](../../apps/web/src/server/developer-docs.ts), [payments.ts](../../apps/web/src/server/payments.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/developers/guides/[guide]

- Type: page.
- Source: [apps/web/src/app/[locale]/developers/guides/[guide]/page.tsx](../../apps/web/src/app/[locale]/developers/guides/[guide]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/sdk, @yayatoh/webhooks/examples.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/developers/guides

- Type: page.
- Source: [apps/web/src/app/[locale]/developers/guides/page.tsx](../../apps/web/src/app/[locale]/developers/guides/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/sdk, @yayatoh/ui, @yayatoh/webhooks/examples.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/developers

- Type: page.
- Source: [apps/web/src/app/[locale]/developers/page.tsx](../../apps/web/src/app/[locale]/developers/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/api-v1, @yayatoh/contracts, @yayatoh/payments, @yayatoh/sdk, @yayatoh/ui, @yayatoh/webhooks/catalog, @yayatoh/webhooks/examples.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [developer-docs.ts](../../apps/web/src/server/developer-docs.ts), [payments.ts](../../apps/web/src/server/payments.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/developers/reference

- Type: page.
- Source: [apps/web/src/app/[locale]/developers/reference/page.tsx](../../apps/web/src/app/[locale]/developers/reference/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/api-v1, @yayatoh/events/ui, @yayatoh/payments, @yayatoh/sdk, @yayatoh/ui, @yayatoh/webhooks/catalog, @yayatoh/webhooks/examples.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [developer-docs.ts](../../apps/web/src/server/developer-docs.ts), [payments.ts](../../apps/web/src/server/payments.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/display/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/display/[token]/page.tsx](../../apps/web/src/app/[locale]/display/[token]/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/events, @yayatoh/pdf, @yayatoh/platform.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/engagement/client, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [engagement.ts](../../apps/web/src/server/engagement.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/embed/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/embed/[slug]/page.tsx](../../apps/web/src/app/[locale]/embed/[slug]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/marketplace.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/events/ui, @yayatoh/floorplan, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/reviews, @yayatoh/reviews/ui, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [advanced-seating.ts](../../apps/web/src/server/advanced-seating.ts), [attribution.ts](../../apps/web/src/server/attribution.ts), [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [demo.ts](../../apps/web/src/server/demo.ts), [dev.ts](../../apps/web/src/server/dev.ts), [exhibitor-map.ts](../../apps/web/src/server/exhibitor-map.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [public-data.ts](../../apps/web/src/server/public-data.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [search.ts](../../apps/web/src/server/search.ts), [seat-finder.ts](../../apps/web/src/server/seat-finder.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: attachPaymentCommand, attributeOrderCommand, holdBestAvailableCommand, publicVenueMapQuery, recordCheckoutBlockCommand, redeemAccessCodeCommand, releaseBestAvailableCommand, reportReviewCommand, requestHolderLinkCommand, startCheckoutCommand.
- Direct guard calls: notFound.

### web /[locale]/event-portal/chat/[conversation]

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/chat/[conversation]/page.tsx](../../apps/web/src/app/[locale]/event-portal/chat/[conversation]/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: blockVisitorCommand, boothChatThreadQuery, chatInboxQuery, completePortalTaskCommand, exhibitorPortalQuery, markBoothReadCommand, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, proposeProfileChangeCommand, proposeSessionChangeCommand, replyBoothChatCommand, reportVisitorCommand, setBoothChatCommand, speakerPortalQuery.
- Direct guard calls: notFound.

### web /[locale]/event-portal/chat

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/chat/page.tsx](../../apps/web/src/app/[locale]/event-portal/chat/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: blockVisitorCommand, boothInboxQuery, chatInboxQuery, completePortalTaskCommand, exhibitorPortalQuery, markBoothReadCommand, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, proposeProfileChangeCommand, proposeSessionChangeCommand, replyBoothChatCommand, reportVisitorCommand, setBoothChatCommand, speakerPortalQuery.
- Direct guard calls: notFound.

### web /[locale]/event-portal/chat/stream

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/event-portal/chat/stream/route.ts](../../apps/web/src/app/[locale]/event-portal/chat/stream/route.ts).
- Direct domain imports: @yayatoh/engagement, @yayatoh/events.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: speakerPortalQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/event-portal/confirm

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/confirm/page.tsx](../../apps/web/src/app/[locale]/event-portal/confirm/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: acceptLeadTermsCommand, completePortalTaskCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, saveLeadSettingsCommand, speakerPortalQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/event-portal/invite/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/invite/[token]/page.tsx](../../apps/web/src/app/[locale]/event-portal/invite/[token]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: completePortalTaskCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, speakerPortalQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/event-portal

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/page.tsx](../../apps/web/src/app/[locale]/event-portal/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/leads, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cfp-portal.ts](../../apps/web/src/server/cfp-portal.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: acceptLeadTermsCommand, attachPaymentCommand, boothInboxQuery, cfpReviewerHomeQuery, completePortalTaskCommand, exhibitorPortalQuery, leadSetupQuery, portalAssignLeadLicenseCommand, portalExhibitorLogoQuery, portalInviteStaffCommand, portalLeadLicensesQuery, portalReleaseLeadLicenseCommand, portalRevokeStaffCommand, portalSaveProfileCommand, portalSetDeliverableDoneCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, saveLeadSettingsCommand, speakerPortalQuery, sponsorCompUsageQuery, sponsorPortalQuery, startLeadLicenseCheckoutCommand, startSponsorPackageCheckoutCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/event-portal/profile

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/profile/page.tsx](../../apps/web/src/app/[locale]/event-portal/profile/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/media, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: completePortalTaskCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, speakerPortalQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/event-portal/reviews/[submission]

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/reviews/[submission]/page.tsx](../../apps/web/src/app/[locale]/event-portal/reviews/[submission]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cfp-portal.ts](../../apps/web/src/server/cfp-portal.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: cfpReviewerHomeQuery, cfpReviewerSubmissionQuery, completePortalTaskCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, speakerPortalQuery, submitCfpReviewCommand.
- Direct guard calls: notFound.

### web /[locale]/event-portal/sessions/[session]

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/sessions/[session]/page.tsx](../../apps/web/src/app/[locale]/event-portal/sessions/[session]/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: completePortalTaskCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, speakerPortalQuery.
- Direct guard calls: notFound.

### web /[locale]/event-portal/sign-in/[site]

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/sign-in/[site]/page.tsx](../../apps/web/src/app/[locale]/event-portal/sign-in/[site]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: completePortalTaskCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, speakerPortalQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/event-portal/tasks

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/tasks/page.tsx](../../apps/web/src/app/[locale]/event-portal/tasks/page.tsx).
- Direct domain imports: @yayatoh/media, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: completePortalTaskCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, speakerPortalQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/event-portal/verify/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/event-portal/verify/[token]/page.tsx](../../apps/web/src/app/[locale]/event-portal/verify/[token]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: completePortalTaskCommand, proposeProfileChangeCommand, proposeSessionChangeCommand, speakerPortalQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/events/[slug]/attendee

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/attendee/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/attendee/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/contracts.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/events/[slug]/card

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/card/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/card/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/events.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [saved-card.ts](../../apps/web/src/server/saved-card.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: attachCardSetupCommand, removeSavedCardCommand, startCardSetupCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/cfp

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/cfp/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/cfp/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/program, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [locale.ts](../../apps/web/src/server/locale.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: submitCfpCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/give

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/give/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/give/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/donations/giving, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [saved-card.ts](../../apps/web/src/server/saved-card.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: attachPaymentCommand, giveWithSavedCardCommand, startGiftCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/give/thanks

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/give/thanks/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/give/thanks/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/group/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/group/[token]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/group/[token]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/registration, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [locale.ts](../../apps/web/src/server/locale.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: substituteByPayerCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/live/[session]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/live/[session]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/live/[session]/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/surveys.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/engagement, @yayatoh/engagement/client, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/surveys, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [engagement.ts](../../apps/web/src/server/engagement.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: askQuestionCommand, feedbackPromptQuery, openFeedbackCommand, upvoteQuestionCommand, voteCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/network

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/network/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/network/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: blockPersonCommand, cancelMeetingCommand, chatInboxQuery, directoryQuery, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, optInCommand, optOutCommand, reportPersonCommand, requestConnectionCommand, requestMeetingCommand, requestOrderLinksCommand, respondConnectionCommand, respondMeetingCommand, suggestedMatchesQuery, unblockPersonCommand, updateProfileCommand, withdrawConnectionCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/events/ui, @yayatoh/floorplan, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/reviews, @yayatoh/reviews/ui, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [advanced-seating.ts](../../apps/web/src/server/advanced-seating.ts), [attribution.ts](../../apps/web/src/server/attribution.ts), [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [demo.ts](../../apps/web/src/server/demo.ts), [dev.ts](../../apps/web/src/server/dev.ts), [event-metadata.ts](../../apps/web/src/server/event-metadata.ts), [exhibitor-map.ts](../../apps/web/src/server/exhibitor-map.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [public-data.ts](../../apps/web/src/server/public-data.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [search.ts](../../apps/web/src/server/search.ts), [seat-finder.ts](../../apps/web/src/server/seat-finder.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: attachPaymentCommand, attributeOrderCommand, holdBestAvailableCommand, publicVenueMapQuery, recordCheckoutBlockCommand, redeemAccessCodeCommand, releaseBestAvailableCommand, reportReviewCommand, requestHolderLinkCommand, startCheckoutCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/events/[slug]/pledge/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/pledge/[token]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/pledge/[token]/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: attachPaymentCommand, startPledgePaymentCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/register

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/register/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/register/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/registration, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest-verify.ts](../../apps/web/src/server/guest-verify.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: applyCommand, attachPaymentCommand, joinRegistrationWaitlistCommand, startRegistrationCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/registration-form

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/registration-form/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/registration-form/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/forms, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/events, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [registration-forms.ts](../../apps/web/src/server/registration-forms.ts), [registration-types.ts](../../apps/web/src/server/registration-types.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, registrationTypeRefsQuery, saveRegistrationPageCommand, startRegistrationFormCommand, submitRegistrationForm, teamEventBySlugQuery.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/registration/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/registration/[token]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/registration/[token]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/registration, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [locale.ts](../../apps/web/src/server/locale.ts), [payments.ts](../../apps/web/src/server/payments.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [registration-pay.ts](../../apps/web/src/server/registration-pay.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addGuestCommand, attachPaymentCommand, payApprovedCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/seat-finder

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/seat-finder/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/seat-finder/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/assistance, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/ui.
- Server files: [assistance.ts](../../apps/web/src/server/assistance.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [seat-finder.ts](../../apps/web/src/server/seat-finder.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: findGuestSeatByPinCommand, findSeatByNameCommand, finderResultQuery, publicVenueMapQuery, requestFinderCodeCommand, verifyFinderCodeCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/seats/stream

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/events/[slug]/seats/stream/route.ts](../../apps/web/src/app/[locale]/events/[slug]/seats/stream/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/platform/security.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/events/[slug]/unlock

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/unlock/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/unlock/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/reviews, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [attribution.ts](../../apps/web/src/server/attribution.ts), [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: attachPaymentCommand, attributeOrderCommand, holdBestAvailableCommand, recordCheckoutBlockCommand, redeemAccessCodeCommand, releaseBestAvailableCommand, reportReviewCommand, requestHolderLinkCommand, startCheckoutCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/events/[slug]/waitlist

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/waitlist/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/waitlist/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/seating, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest-verify.ts](../../apps/web/src/server/guest-verify.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: joinWaitlistCommand.
- Direct guard calls: notFound.

### web /[locale]/events

- Type: page.
- Source: [apps/web/src/app/[locale]/events/page.tsx](../../apps/web/src/app/[locale]/events/page.tsx).
- Direct domain imports: @yayatoh/marketplace.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/reviews, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [public-data.ts](../../apps/web/src/server/public-data.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [search.ts](../../apps/web/src/server/search.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/features

- Type: page.
- Source: [apps/web/src/app/[locale]/features/page.tsx](../../apps/web/src/app/[locale]/features/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [help.ts](../../apps/web/src/server/help.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/forgot-password

- Type: page.
- Source: [apps/web/src/app/[locale]/forgot-password/page.tsx](../../apps/web/src/app/[locale]/forgot-password/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/giving-screen/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/giving-screen/[token]/page.tsx](../../apps/web/src/app/[locale]/giving-screen/[token]/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/events, @yayatoh/pdf, @yayatoh/platform.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/donations/screen, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [engagement.ts](../../apps/web/src/server/engagement.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/help/[category]/[article]

- Type: page.
- Source: [apps/web/src/app/[locale]/help/[category]/[article]/page.tsx](../../apps/web/src/app/[locale]/help/[category]/[article]/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/contracts.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/cms/ui, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [help.ts](../../apps/web/src/server/help.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: submitHelpFeedbackCommand.
- Direct guard calls: notFound.

### web /[locale]/help/[category]

- Type: page.
- Source: [apps/web/src/app/[locale]/help/[category]/page.tsx](../../apps/web/src/app/[locale]/help/[category]/page.tsx).
- Direct domain imports: @yayatoh/cms.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [help.ts](../../apps/web/src/server/help.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/help

- Type: page.
- Source: [apps/web/src/app/[locale]/help/page.tsx](../../apps/web/src/app/[locale]/help/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [help.ts](../../apps/web/src/server/help.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/help/search

- Type: page.
- Source: [apps/web/src/app/[locale]/help/search/page.tsx](../../apps/web/src/app/[locale]/help/search/page.tsx).
- Direct domain imports: @yayatoh/cms, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [help.ts](../../apps/web/src/server/help.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/hub/[token]/manifest

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/hub/[token]/manifest/route.ts](../../apps/web/src/app/[locale]/hub/[token]/manifest/route.ts).
- Direct domain imports: @yayatoh/contracts, @yayatoh/ui/tokens.
- Connected packages: @yayatoh/contracts, @yayatoh/guests, @yayatoh/kernel, @yayatoh/seating, @yayatoh/ticketing, @yayatoh/ui/tokens.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [guest-hub.ts](../../apps/web/src/server/guest-hub.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: markRsvpViewedCommand, partyHub.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/hub/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/hub/[token]/page.tsx](../../apps/web/src/app/[locale]/hub/[token]/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/guests, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/seating, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [guest-hub.ts](../../apps/web/src/server/guest-hub.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: markRsvpViewedCommand, partyHub.
- Direct guard calls: notFound.

### web /[locale]/hub/[token]/pass/[platform]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/hub/[token]/pass/[platform]/route.ts](../../apps/web/src/app/[locale]/hub/[token]/pass/[platform]/route.ts).
- Direct domain imports: @yayatoh/guests.
- Connected packages: @yayatoh/contracts, @yayatoh/guests, @yayatoh/kernel, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [guest-hub.ts](../../apps/web/src/server/guest-hub.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: markRsvpViewedCommand, partyHub.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/invite/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/invite/[token]/page.tsx](../../apps/web/src/app/[locale]/invite/[token]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/legal/[org]/[kind]

- Type: page.
- Source: [apps/web/src/app/[locale]/legal/[org]/[kind]/page.tsx](../../apps/web/src/app/[locale]/legal/[org]/[kind]/page.tsx).
- Direct domain imports: @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/tenancy, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/messages/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/messages/[token]/page.tsx](../../apps/web/src/app/[locale]/messages/[token]/page.tsx).
- Direct domain imports: @yayatoh/messaging, @yayatoh/ui.
- Connected packages: @yayatoh/kernel, @yayatoh/messaging, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: contactBlockCommand, contactMessageCommand, contactReportCommand.
- Direct guard calls: notFound.

### web /[locale]/my-tickets

- Type: page.
- Source: [apps/web/src/app/[locale]/my-tickets/page.tsx](../../apps/web/src/app/[locale]/my-tickets/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: requestOrderLinksCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/o

- Type: page.
- Source: [apps/web/src/app/[locale]/o/page.tsx](../../apps/web/src/app/[locale]/o/page.tsx).
- Direct domain imports: @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /[locale]/orders/[token]/hub/manifest

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/orders/[token]/hub/manifest/route.ts](../../apps/web/src/app/[locale]/orders/[token]/hub/manifest/route.ts).
- Direct domain imports: @yayatoh/contracts, @yayatoh/ui/tokens.
- Connected packages: @yayatoh/contracts, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/registration, @yayatoh/ui/tokens.
- Server files: [conference-hub.ts](../../apps/web/src/server/conference-hub.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: conferenceHubQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/orders/[token]/hub

- Type: page.
- Source: [apps/web/src/app/[locale]/orders/[token]/hub/page.tsx](../../apps/web/src/app/[locale]/orders/[token]/hub/page.tsx).
- Direct domain imports: @yayatoh/registration, @yayatoh/ui, @yayatoh/ui/tokens.
- Connected packages: @yayatoh/contracts, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [conference-hub.ts](../../apps/web/src/server/conference-hub.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: acceptSessionOfferCommand, conferenceHubQuery, dropSessionCommand, enrollSessionCommand, favoriteSessionCommand, rotateCalendarFeedCommand.
- Direct guard calls: notFound.

### web /[locale]/orders/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/orders/[token]/page.tsx](../../apps/web/src/app/[locale]/orders/[token]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/ui.
- Connected packages: @yayatoh/assistance, @yayatoh/ce, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/reviews, @yayatoh/reviews/ui, @yayatoh/ui, @yayatoh/virtual.
- Server files: [assistance.ts](../../apps/web/src/server/assistance.ts), [ce.ts](../../apps/web/src/server/ce.ts), [conference-hub.ts](../../apps/web/src/server/conference-hub.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [schedule.ts](../../apps/web/src/server/schedule.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [virtual.ts](../../apps/web/src/server/virtual.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: certificateLinksQuery, conferenceHubQuery, myScheduleQuery, registerOrderPushCommand, removeOrderPushCommand, requestRefundCommand, submitReviewCommand, watchableTicketsQuery.
- Direct guard calls: notFound.

### web /[locale]/orders/[token]/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/orders/[token]/pdf/route.ts](../../apps/web/src/app/[locale]/orders/[token]/pdf/route.ts).
- Direct domain imports: @yayatoh/contracts, @yayatoh/orders, @yayatoh/pdf.
- Connected packages: @yayatoh/contracts, @yayatoh/kernel, @yayatoh/orders, @yayatoh/pdf.
- Server files: [pdf.ts](../../apps/web/src/server/pdf.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/orders/[token]/schedule/calendar/[registrant]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/orders/[token]/schedule/calendar/[registrant]/route.ts](../../apps/web/src/app/[locale]/orders/[token]/schedule/calendar/[registrant]/route.ts).
- Direct domain imports: @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/orders.
- Connected packages: @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/orders.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: completePersonalCalendarCommand, failPersonalCalendarCommand, pendingPersonalCalendarQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/orders/[token]/schedule

- Type: page.
- Source: [apps/web/src/app/[locale]/orders/[token]/schedule/page.tsx](../../apps/web/src/app/[locale]/orders/[token]/schedule/page.tsx).
- Direct domain imports: @yayatoh/integrations, @yayatoh/kernel, @yayatoh/orders, @yayatoh/registration, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/integrations, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [integrations.ts](../../apps/web/src/server/integrations.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: acceptSessionOfferCommand, beginPersonalCalendarCommand, dropSessionCommand, enrollSessionCommand, myScheduleQuery, personalCalendarQuery, stopPersonalCalendarCommand, syncPersonalCalendarCommand.
- Direct guard calls: notFound.

### web /[locale]/organizers/[slug]/blogs/[post]

- Type: page.
- Source: [apps/web/src/app/[locale]/organizers/[slug]/blogs/[post]/page.tsx](../../apps/web/src/app/[locale]/organizers/[slug]/blogs/[post]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/organizers/[slug]/blogs

- Type: page.
- Source: [apps/web/src/app/[locale]/organizers/[slug]/blogs/page.tsx](../../apps/web/src/app/[locale]/organizers/[slug]/blogs/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/organizers/[slug]/contact

- Type: page.
- Source: [apps/web/src/app/[locale]/organizers/[slug]/contact/page.tsx](../../apps/web/src/app/[locale]/organizers/[slug]/contact/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seat-finder.ts](../../apps/web/src/server/seat-finder.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: publicVenueMapQuery, submitOrgContactCommand.
- Direct guard calls: notFound.

### web /[locale]/organizers/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/organizers/[slug]/page.tsx](../../apps/web/src/app/[locale]/organizers/[slug]/page.tsx).
- Direct domain imports: @yayatoh/marketplace.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/reviews, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [public-data.ts](../../apps/web/src/server/public-data.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [search.ts](../../apps/web/src/server/search.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/organizers/[slug]/pages/[page]

- Type: page.
- Source: [apps/web/src/app/[locale]/organizers/[slug]/pages/[page]/page.tsx](../../apps/web/src/app/[locale]/organizers/[slug]/pages/[page]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]

- Type: page.
- Source: [apps/web/src/app/[locale]/page.tsx](../../apps/web/src/app/[locale]/page.tsx).
- Direct domain imports: @yayatoh/marketplace, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/reviews, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [help.ts](../../apps/web/src/server/help.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [public-data.ts](../../apps/web/src/server/public-data.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [search.ts](../../apps/web/src/server/search.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/pages/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/pages/[slug]/page.tsx](../../apps/web/src/app/[locale]/pages/[slug]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/preferences/[org]/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/preferences/[org]/[token]/page.tsx](../../apps/web/src/app/[locale]/preferences/[org]/[token]/page.tsx).
- Direct domain imports: @yayatoh/notifications, @yayatoh/ui.
- Connected packages: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: savePreferenceCenterCommand.
- Direct guard calls: notFound.

### web /[locale]/pricing

- Type: page.
- Source: [apps/web/src/app/[locale]/pricing/page.tsx](../../apps/web/src/app/[locale]/pricing/page.tsx).
- Direct domain imports: @yayatoh/billing, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/privacy-request/[org]/archive/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/privacy-request/[org]/archive/[token]/route.ts](../../apps/web/src/app/[locale]/privacy-request/[org]/archive/[token]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/privacy, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [dsar-receipt.ts](../../apps/web/src/server/dsar-receipt.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [privacy-request.ts](../../apps/web/src/server/privacy-request.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: selfArchiveFileQuery, selfReceiptQuery, submitSelfRequestCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/privacy-request/[org]

- Type: page.
- Source: [apps/web/src/app/[locale]/privacy-request/[org]/page.tsx](../../apps/web/src/app/[locale]/privacy-request/[org]/page.tsx).
- Direct domain imports: @yayatoh/db, @yayatoh/kernel, @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/privacy, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [privacy-request.ts](../../apps/web/src/server/privacy-request.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: selfArchiveFileQuery, selfReceiptQuery, submitSelfRequestCommand.
- Direct guard calls: notFound.

### web /[locale]/privacy-request/[org]/receipt/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/privacy-request/[org]/receipt/[token]/route.ts](../../apps/web/src/app/[locale]/privacy-request/[org]/receipt/[token]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/privacy, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [dsar-receipt.ts](../../apps/web/src/server/dsar-receipt.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [privacy-request.ts](../../apps/web/src/server/privacy-request.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: selfArchiveFileQuery, selfReceiptQuery, submitSelfRequestCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/privacy

- Type: page.
- Source: [apps/web/src/app/[locale]/privacy/page.tsx](../../apps/web/src/app/[locale]/privacy/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/r/[code]

- Type: endpoint.
- Source: [apps/web/src/app/[locale]/r/[code]/route.ts](../../apps/web/src/app/[locale]/r/[code]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/contracts, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/platform, @yayatoh/platform/security.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [redirector.ts](../../apps/web/src/server/redirector.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: recordClickCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/receipts/[org]/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/receipts/[org]/[token]/route.ts](../../apps/web/src/app/[locale]/receipts/[org]/[token]/route.ts).
- Direct domain imports: @yayatoh/donations.
- Connected packages: @yayatoh/contracts, @yayatoh/donations, @yayatoh/pdf.
- Server files: [pdf.ts](../../apps/web/src/server/pdf.ts), [receipt-pdf.ts](../../apps/web/src/server/receipt-pdf.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/registration-form/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/registration-form/[token]/page.tsx](../../apps/web/src/app/[locale]/registration-form/[token]/page.tsx).
- Direct domain imports: @yayatoh/forms, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/events, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [registration-forms.ts](../../apps/web/src/server/registration-forms.ts), [registration-types.ts](../../apps/web/src/server/registration-types.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: getEventBySlugQuery, getOrganizationQuery, listMediaQuery, registrationTypeRefsQuery, saveRegistrationPageCommand, startRegistrationFormCommand, submitRegistrationForm, teamEventBySlugQuery.
- Direct guard calls: notFound.

### web /[locale]/reset-password

- Type: page.
- Source: [apps/web/src/app/[locale]/reset-password/page.tsx](../../apps/web/src/app/[locale]/reset-password/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/search

- Type: page.
- Source: [apps/web/src/app/[locale]/search/page.tsx](../../apps/web/src/app/[locale]/search/page.tsx).
- Direct domain imports: @yayatoh/marketplace.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/reviews, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [public-data.ts](../../apps/web/src/server/public-data.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [search.ts](../../apps/web/src/server/search.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound, redirect.

### web /[locale]/series/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/series/[slug]/page.tsx](../../apps/web/src/app/[locale]/series/[slug]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/session-checkin/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/session-checkin/[token]/page.tsx](../../apps/web/src/app/[locale]/session-checkin/[token]/page.tsx).
- Direct domain imports: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: selfCheckInCommand, selfCheckinPageQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/sign-in/link

- Type: page.
- Source: [apps/web/src/app/[locale]/sign-in/link/page.tsx](../../apps/web/src/app/[locale]/sign-in/link/page.tsx).
- Direct domain imports: @yayatoh/auth, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sign-in-finish.ts](../../apps/web/src/server/sign-in-finish.ts), [social.ts](../../apps/web/src/server/social.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/sign-in

- Type: page.
- Source: [apps/web/src/app/[locale]/sign-in/page.tsx](../../apps/web/src/app/[locale]/sign-in/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/auth/client, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session-actions.ts](../../apps/web/src/server/session-actions.ts), [session.ts](../../apps/web/src/server/session.ts), [social.ts](../../apps/web/src/server/social.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [sso.ts](../../apps/web/src/server/sso.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: completeSsoLoginCommand, endImpersonationCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/sign-in/sso

- Type: page.
- Source: [apps/web/src/app/[locale]/sign-in/sso/page.tsx](../../apps/web/src/app/[locale]/sign-in/sso/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/sso, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [sso.ts](../../apps/web/src/server/sso.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: completeSsoLoginCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/signup

- Type: page.
- Source: [apps/web/src/app/[locale]/signup/page.tsx](../../apps/web/src/app/[locale]/signup/page.tsx).
- Direct domain imports: @yayatoh/tenancy, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/statements/[org]/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/statements/[org]/[token]/route.ts](../../apps/web/src/app/[locale]/statements/[org]/[token]/route.ts).
- Direct domain imports: @yayatoh/donations.
- Connected packages: @yayatoh/contracts, @yayatoh/donations, @yayatoh/pdf.
- Server files: [pdf.ts](../../apps/web/src/server/pdf.ts), [receipt-pdf.ts](../../apps/web/src/server/receipt-pdf.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/status

- Type: page.
- Source: [apps/web/src/app/[locale]/status/page.tsx](../../apps/web/src/app/[locale]/status/page.tsx).
- Direct domain imports: @yayatoh/platform, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/sub-processors

- Type: page.
- Source: [apps/web/src/app/[locale]/sub-processors/page.tsx](../../apps/web/src/app/[locale]/sub-processors/page.tsx).
- Direct domain imports: @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/survey/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/survey/[token]/page.tsx](../../apps/web/src/app/[locale]/survey/[token]/page.tsx).
- Direct domain imports: @yayatoh/surveys, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/surveys, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: submitSurveyResponseCommand.
- Direct guard calls: notFound.

### web /[locale]/tables/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/tables/[token]/page.tsx](../../apps/web/src/app/[locale]/tables/[token]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/orders, @yayatoh/ui.
- Connected packages: @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: nameTableSlotCommand, publicTableQuery, resendTableLinkCommand, setTableCompanyCommand.
- Direct guard calls: notFound.

### web /[locale]/tv/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/tv/[token]/page.tsx](../../apps/web/src/app/[locale]/tv/[token]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/command-center, @yayatoh/kernel, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tv.ts](../../apps/web/src/server/tv.ts).
- Operations in local dependency chain: tvBoardQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/unsubscribe/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/unsubscribe/[token]/page.tsx](../../apps/web/src/app/[locale]/unsubscribe/[token]/page.tsx).
- Direct domain imports: @yayatoh/notifications, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: resubscribeCommand, unsubscribeCommand.
- Direct guard calls: notFound.

### web /[locale]/venues/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/venues/[slug]/page.tsx](../../apps/web/src/app/[locale]/venues/[slug]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/media, @yayatoh/ui, @yayatoh/venues.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/venues.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: submitQuoteRequestCommand.
- Direct guard calls: notFound.

### web /[locale]/venues

- Type: page.
- Source: [apps/web/src/app/[locale]/venues/page.tsx](../../apps/web/src/app/[locale]/venues/page.tsx).
- Direct domain imports: @yayatoh/ui, @yayatoh/venues.
- Connected packages: @yayatoh/contracts, @yayatoh/kernel, @yayatoh/ui, @yayatoh/venues.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/w/[code]/gallery

- Type: page.
- Source: [apps/web/src/app/[locale]/w/[code]/gallery/page.tsx](../../apps/web/src/app/[locale]/w/[code]/gallery/page.tsx).
- Direct domain imports: @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/gallery, @yayatoh/gallery/client, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addGuestGalleryVideoCommand, publicGalleryQuery, publicSlidesQuery, requestGuestGalleryUploadCommand, unlockGuestSiteQuery.
- Direct guard calls: notFound.

### web /[locale]/w/[code]

- Type: page.
- Source: [apps/web/src/app/[locale]/w/[code]/page.tsx](../../apps/web/src/app/[locale]/w/[code]/page.tsx).
- Direct domain imports: @yayatoh/contracts, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: publicGuestSiteQuery, unlockGuestSiteQuery.
- Direct guard calls: notFound.

### web /[locale]/w/[code]/slideshow

- Type: page.
- Source: [apps/web/src/app/[locale]/w/[code]/slideshow/page.tsx](../../apps/web/src/app/[locale]/w/[code]/slideshow/page.tsx).
- Direct domain imports: @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: addGuestGalleryVideoCommand, publicSlidesQuery, requestGuestGalleryUploadCommand, unlockGuestSiteQuery.
- Direct guard calls: notFound.

### web /[locale]/waitlist/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/waitlist/[token]/page.tsx](../../apps/web/src/app/[locale]/waitlist/[token]/page.tsx).
- Direct domain imports: @yayatoh/forms, @yayatoh/kernel, @yayatoh/orders, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: attachPaymentCommand, command, startCheckoutCommand, startRegistrationCommand.
- Direct guard calls: notFound.

### web /[locale]/webhook-portal/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/webhook-portal/[token]/page.tsx](../../apps/web/src/app/[locale]/webhook-portal/[token]/page.tsx).
- Direct domain imports: @yayatoh/ui, @yayatoh/webhooks.
- Connected packages: @yayatoh/ui, @yayatoh/webhooks.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound, verifyFakePortalToken.

### web /media/[org]/[asset]/[file]

- Type: endpoint (GET).
- Source: [apps/web/src/app/media/[org]/[asset]/[file]/route.ts](../../apps/web/src/app/media/[org]/[asset]/[file]/route.ts).
- Direct domain imports: @yayatoh/media, @yayatoh/seating.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /robots.txt

- Type: endpoint (GET).
- Source: [apps/web/src/app/robots.txt/route.ts](../../apps/web/src/app/robots.txt/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/platform/security, @yayatoh/tenancy.
- Server files: [host-site.ts](../../apps/web/src/server/host-site.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /sitemap.xml

- Type: endpoint (GET).
- Source: [apps/web/src/app/sitemap.xml/route.ts](../../apps/web/src/app/sitemap.xml/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/cms, @yayatoh/contracts, @yayatoh/marketplace, @yayatoh/tenancy.
- Server files: [cms.ts](../../apps/web/src/server/cms.ts), [host-site.ts](../../apps/web/src/server/host-site.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [sitemap-pages.ts](../../apps/web/src/server/sitemap-pages.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /sitemaps/[file]

- Type: endpoint (GET).
- Source: [apps/web/src/app/sitemaps/[file]/route.ts](../../apps/web/src/app/sitemaps/[file]/route.ts).
- Direct domain imports: @yayatoh/contracts.
- Connected packages: @yayatoh/cms, @yayatoh/contracts, @yayatoh/marketplace, @yayatoh/tenancy.
- Server files: [cms.ts](../../apps/web/src/server/cms.ts), [host-site.ts](../../apps/web/src/server/host-site.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [sitemap-pages.ts](../../apps/web/src/server/sitemap-pages.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

## public and attendee

### web /[locale]/checkout/fake

- Type: page.
- Source: [apps/web/src/app/[locale]/checkout/fake/page.tsx](../../apps/web/src/app/[locale]/checkout/fake/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/kernel, @yayatoh/payments, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/checkout/fake/setup

- Type: page.
- Source: [apps/web/src/app/[locale]/checkout/fake/setup/page.tsx](../../apps/web/src/app/[locale]/checkout/fake/setup/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/payments, @yayatoh/ui.
- Connected packages: @yayatoh/kernel, @yayatoh/payments, @yayatoh/ui.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/e/[short]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/e/[short]/route.ts](../../apps/web/src/app/[locale]/e/[short]/route.ts).
- Direct domain imports: @yayatoh/contracts, @yayatoh/events.
- Connected packages: @yayatoh/contracts, @yayatoh/events.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: redirect.

### web /[locale]/events/[slug]/invoice/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/invoice/[token]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/invoice/[token]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [locale.ts](../../apps/web/src/server/locale.ts), [payments.ts](../../apps/web/src/server/payments.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: attachInvoicePaymentCommand, startInvoicePaymentCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/invoice/[token]/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/events/[slug]/invoice/[token]/pdf/route.ts](../../apps/web/src/app/[locale]/events/[slug]/invoice/[token]/pdf/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/orders.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/pdf.
- Server files: [invoice-pdf.ts](../../apps/web/src/server/invoice-pdf.ts), [pdf.ts](../../apps/web/src/server/pdf.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/network/booths/[exhibitor]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/network/booths/[exhibitor]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/network/booths/[exhibitor]/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: blockBoothCommand, boothThreadQuery, chatInboxQuery, markChatReadCommand, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, reportChatCommand, sendBoothMessageCommand, sendChatMessageCommand.
- Direct guard calls: notFound, redirect.

### web /[locale]/events/[slug]/network/chat/[person]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/network/chat/[person]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/network/chat/[person]/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: blockBoothCommand, blockPersonCommand, cancelMeetingCommand, chatInboxQuery, chatThreadQuery, markChatReadCommand, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, optInCommand, optOutCommand, reportChatCommand, reportPersonCommand, requestConnectionCommand, requestMeetingCommand, respondConnectionCommand, respondMeetingCommand, sendBoothMessageCommand, sendChatMessageCommand, unblockPersonCommand, updateProfileCommand, withdrawConnectionCommand.
- Direct guard calls: notFound, redirect.

### web /[locale]/events/[slug]/network/chat

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/network/chat/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/network/chat/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: chatInboxQuery, myConnectionsQuery, myMeetingsQuery, networkHomeQuery.
- Direct guard calls: notFound, redirect.

### web /[locale]/events/[slug]/network/chat/stream

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/events/[slug]/network/chat/stream/route.ts](../../apps/web/src/app/[locale]/events/[slug]/network/chat/stream/route.ts).
- Direct domain imports: @yayatoh/engagement.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: chatInboxQuery, myConnectionsQuery, myMeetingsQuery, networkHomeQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/events/[slug]/network/connections

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/network/connections/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/network/connections/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: blockPersonCommand, cancelMeetingCommand, chatInboxQuery, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, optInCommand, optOutCommand, reportPersonCommand, requestConnectionCommand, requestMeetingCommand, respondConnectionCommand, respondMeetingCommand, unblockPersonCommand, updateProfileCommand, withdrawConnectionCommand.
- Direct guard calls: notFound, redirect.

### web /[locale]/events/[slug]/network/meetings/[meeting]/ics

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/events/[slug]/network/meetings/[meeting]/ics/route.ts](../../apps/web/src/app/[locale]/events/[slug]/network/meetings/[meeting]/ics/route.ts).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: chatInboxQuery, myConnectionsQuery, myMeetingQuery, myMeetingsQuery, networkHomeQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/events/[slug]/network/meetings

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/network/meetings/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/network/meetings/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: blockPersonCommand, cancelMeetingCommand, chatInboxQuery, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, optInCommand, optOutCommand, reportPersonCommand, requestConnectionCommand, requestMeetingCommand, respondConnectionCommand, respondMeetingCommand, unblockPersonCommand, updateProfileCommand, withdrawConnectionCommand.
- Direct guard calls: notFound, redirect.

### web /[locale]/events/[slug]/network/people/[person]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/network/people/[person]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/network/people/[person]/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: blockPersonCommand, cancelMeetingCommand, chatInboxQuery, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, optInCommand, optOutCommand, personQuery, reportPersonCommand, requestConnectionCommand, requestMeetingCommand, respondConnectionCommand, respondMeetingCommand, unblockPersonCommand, updateProfileCommand, withdrawConnectionCommand.
- Direct guard calls: notFound, redirect.

### web /[locale]/events/[slug]/network/profile

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/network/profile/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/network/profile/page.tsx).
- Direct domain imports: @yayatoh/engagement, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [networking.ts](../../apps/web/src/server/networking.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: blockPersonCommand, blockedQuery, cancelMeetingCommand, chatInboxQuery, myConnectionsQuery, myMeetingsQuery, networkHomeQuery, optInCommand, optOutCommand, reportPersonCommand, requestConnectionCommand, requestMeetingCommand, respondConnectionCommand, respondMeetingCommand, unblockPersonCommand, updateProfileCommand, withdrawConnectionCommand.
- Direct guard calls: notFound, redirect.

### web /[locale]/events/[slug]/register/group

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/register/group/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/register/group/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/registration, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest-verify.ts](../../apps/web/src/server/guest-verify.ts), [guest.ts](../../apps/web/src/server/guest.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [registration-pay.ts](../../apps/web/src/server/registration-pay.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: attachPaymentCommand, startGroupCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/seat-finder/help/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/seat-finder/help/[token]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/seat-finder/help/[token]/page.tsx).
- Direct domain imports: @yayatoh/assistance, @yayatoh/events, @yayatoh/kernel, @yayatoh/ui.
- Connected packages: @yayatoh/assistance, @yayatoh/assistance/client, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: guestRequestCommand, guestStatusQuery.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/seat-finder/help

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/seat-finder/help/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/seat-finder/help/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/ui.
- Connected packages: @yayatoh/assistance, @yayatoh/assistance/client, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [assistance.ts](../../apps/web/src/server/assistance.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: guestRequestCommand.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/seat-finder/poster

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/seat-finder/poster/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/seat-finder/poster/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/pdf.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [seat-finder.ts](../../apps/web/src/server/seat-finder.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: publicVenueMapQuery.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/watch/[ticket]/[session]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/watch/[ticket]/[session]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/watch/[ticket]/[session]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/virtual.
- Connected packages: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/virtual.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [locale.ts](../../apps/web/src/server/locale.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [virtual.ts](../../apps/web/src/server/virtual.ts).
- Operations in local dependency chain: startPlaybackCommand, viewerQuery, watchableTicketsQuery.
- Direct guard calls: notFound.

### web /[locale]/events/[slug]/watch/[ticket]

- Type: page.
- Source: [apps/web/src/app/[locale]/events/[slug]/watch/[ticket]/page.tsx](../../apps/web/src/app/[locale]/events/[slug]/watch/[ticket]/page.tsx).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/ui, @yayatoh/virtual.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/ui, @yayatoh/virtual.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [locale.ts](../../apps/web/src/server/locale.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: viewerQuery.
- Direct guard calls: notFound.

### web /[locale]/my-tickets/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/my-tickets/[token]/page.tsx](../../apps/web/src/app/[locale]/my-tickets/[token]/page.tsx).
- Direct domain imports: @yayatoh/kernel, @yayatoh/ticketing, @yayatoh/ui.
- Connected packages: @yayatoh/events, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/leads, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ticketing, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [form.ts](../../apps/web/src/server/form.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: cancelHolderTransferCommand, giveTicketCommand, holderTicketsQuery, setExhibitorEmailSharingCommand, startHolderTransferCommand, whoScannedMeQuery, withdrawLeadEmailCommand.
- Direct guard calls: notFound.

### web /[locale]/my-tickets/verify/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/my-tickets/verify/[token]/page.tsx](../../apps/web/src/app/[locale]/my-tickets/verify/[token]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: requestOrderLinksCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/rsvp/[token]/card

- Type: page.
- Source: [apps/web/src/app/[locale]/rsvp/[token]/card/page.tsx](../../apps/web/src/app/[locale]/rsvp/[token]/card/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/guests.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [saved-card.ts](../../apps/web/src/server/saved-card.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: attachCardSetupCommand, removeSavedCardCommand, startCardSetupCommand.
- Direct guard calls: notFound.

### web /[locale]/rsvp/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/rsvp/[token]/page.tsx](../../apps/web/src/app/[locale]/rsvp/[token]/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/kernel, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/forms/ui, @yayatoh/guests, @yayatoh/kernel, @yayatoh/seating, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: markRsvpViewedCommand, partySeatsQuery, publicRsvpQuery, publicRsvpQuestionsQuery, submitRsvpCommand.
- Direct guard calls: notFound.

### web /[locale]/rsvp/[token]/seat

- Type: page.
- Source: [apps/web/src/app/[locale]/rsvp/[token]/seat/page.tsx](../../apps/web/src/app/[locale]/rsvp/[token]/seat/page.tsx).
- Direct domain imports: @yayatoh/donations, @yayatoh/guests, @yayatoh/kernel, @yayatoh/seating, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/donations, @yayatoh/floorplan, @yayatoh/guests, @yayatoh/kernel, @yayatoh/seating, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: partySeatsQuery.
- Direct guard calls: notFound.

### web /[locale]/rsvp/find/[code]

- Type: page.
- Source: [apps/web/src/app/[locale]/rsvp/find/[code]/page.tsx](../../apps/web/src/app/[locale]/rsvp/find/[code]/page.tsx).
- Direct domain imports: @yayatoh/guests, @yayatoh/ui.
- Connected packages: @yayatoh/contracts, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/ui.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: findRsvpByNameCommand.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/blogs/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/blogs/[slug]/page.tsx](../../apps/web/src/app/[locale]/t/[org]/blogs/[slug]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/blogs

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/blogs/page.tsx](../../apps/web/src/app/[locale]/t/[org]/blogs/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/contact

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/contact/page.tsx](../../apps/web/src/app/[locale]/t/[org]/contact/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [form.ts](../../apps/web/src/server/form.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seat-finder.ts](../../apps/web/src/server/seat-finder.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: publicVenueMapQuery, submitOrgContactCommand.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/events/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/events/[slug]/page.tsx](../../apps/web/src/app/[locale]/t/[org]/events/[slug]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/billing, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/events/ui, @yayatoh/floorplan, @yayatoh/forms, @yayatoh/forms/ui, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/registration, @yayatoh/reviews, @yayatoh/reviews/ui, @yayatoh/seating, @yayatoh/seating/client, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [advanced-seating.ts](../../apps/web/src/server/advanced-seating.ts), [attribution.ts](../../apps/web/src/server/attribution.ts), [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [demo.ts](../../apps/web/src/server/demo.ts), [dev.ts](../../apps/web/src/server/dev.ts), [event-metadata.ts](../../apps/web/src/server/event-metadata.ts), [exhibitor-map.ts](../../apps/web/src/server/exhibitor-map.ts), [form.ts](../../apps/web/src/server/form.ts), [guest.ts](../../apps/web/src/server/guest.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [public-data.ts](../../apps/web/src/server/public-data.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [search.ts](../../apps/web/src/server/search.ts), [seat-finder.ts](../../apps/web/src/server/seat-finder.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts), [visitor.ts](../../apps/web/src/server/visitor.ts).
- Operations in local dependency chain: attachPaymentCommand, attributeOrderCommand, holdBestAvailableCommand, publicVenueMapQuery, recordCheckoutBlockCommand, redeemAccessCodeCommand, releaseBestAvailableCommand, reportReviewCommand, requestHolderLinkCommand, startCheckoutCommand.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/events/[slug]/seats/stream

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/t/[org]/events/[slug]/seats/stream/route.ts](../../apps/web/src/app/[locale]/t/[org]/events/[slug]/seats/stream/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/platform/security.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/t/[org]/my-tickets

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/my-tickets/page.tsx](../../apps/web/src/app/[locale]/t/[org]/my-tickets/page.tsx).
- Direct domain imports: @yayatoh/marketplace.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts).
- Operations in local dependency chain: requestOrderLinksCommand.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/my-tickets/verify/[token]

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/my-tickets/verify/[token]/page.tsx](../../apps/web/src/app/[locale]/t/[org]/my-tickets/verify/[token]/page.tsx).
- Direct domain imports: @yayatoh/marketplace.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts).
- Operations in local dependency chain: requestOrderLinksCommand.
- Direct guard calls: notFound.

### web /[locale]/t/[org]

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/page.tsx](../../apps/web/src/app/[locale]/t/[org]/page.tsx).
- Direct domain imports: @yayatoh/marketplace.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/reviews, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [public-data.ts](../../apps/web/src/server/public-data.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [search.ts](../../apps/web/src/server/search.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/pages/[slug]

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/pages/[slug]/page.tsx](../../apps/web/src/app/[locale]/t/[org]/pages/[slug]/page.tsx).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/events/ui, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [seo.ts](../../apps/web/src/server/seo.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [status.ts](../../apps/web/src/server/status.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /[locale]/t/[org]/r/[code]

- Type: endpoint.
- Source: [apps/web/src/app/[locale]/t/[org]/r/[code]/route.ts](../../apps/web/src/app/[locale]/t/[org]/r/[code]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/contracts, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/platform, @yayatoh/platform/security.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [redirector.ts](../../apps/web/src/server/redirector.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts).
- Operations in local dependency chain: recordClickCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/t/[org]/realtime/[channel]

- Type: endpoint (GET).
- Source: [apps/web/src/app/[locale]/t/[org]/realtime/[channel]/route.ts](../../apps/web/src/app/[locale]/t/[org]/realtime/[channel]/route.ts).
- Direct domain imports: @yayatoh/platform/security.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /[locale]/t/[org]/tickets

- Type: page.
- Source: [apps/web/src/app/[locale]/t/[org]/tickets/page.tsx](../../apps/web/src/app/[locale]/t/[org]/tickets/page.tsx).
- Direct domain imports: @yayatoh/marketplace, @yayatoh/orders, @yayatoh/ui.
- Connected packages: @yayatoh/auth, @yayatoh/cms, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/marketplace, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui, @yayatoh/ui/tokens.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [cms.ts](../../apps/web/src/server/cms.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [locale.ts](../../apps/web/src/server/locale.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [public-cache.ts](../../apps/web/src/server/public-cache.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts), [tenant-site.ts](../../apps/web/src/server/tenant-site.ts), [theme-actions.ts](../../apps/web/src/server/theme-actions.ts), [theme.ts](../../apps/web/src/server/theme.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

## web API

### web /api/account/export

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/account/export/route.ts](../../apps/web/src/app/api/account/export/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/privacy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/privacy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/auth/[...all]

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/auth/[...all]/route.ts](../../apps/web/src/app/api/auth/[...all]/route.ts).
- Direct domain imports: @yayatoh/auth, @yayatoh/platform/security.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [human-check.ts](../../apps/web/src/server/human-check.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: requireHumanCheck.

### web /api/badges/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/badges/[token]/route.ts](../../apps/web/src/app/api/badges/[token]/route.ts).
- Direct domain imports: @yayatoh/badges.
- Connected packages: @yayatoh/badges, @yayatoh/pdf.
- Server files: [badge-pdf.ts](../../apps/web/src/server/badge-pdf.ts), [pdf.ts](../../apps/web/src/server/pdf.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/calendar/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/calendar/[token]/route.ts](../../apps/web/src/app/api/calendar/[token]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/platform, @yayatoh/registration.
- Connected packages: @yayatoh/kernel, @yayatoh/platform, @yayatoh/registration.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: calendarFeedQuery.
- Direct guard calls: notFound.

### web /api/command-center/[org]/[event]/[widget]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/command-center/[org]/[event]/[widget]/route.ts](../../apps/web/src/app/api/command-center/[org]/[event]/[widget]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/alerts, @yayatoh/assistance, @yayatoh/auth, @yayatoh/campaigns, @yayatoh/checkin, @yayatoh/command-center, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [command-center.ts](../../apps/web/src/server/command-center.ts), [conference-sources.ts](../../apps/web/src/server/conference-sources.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: def, getEventBySlugQuery, reportPresenceCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/command-center/[org]/[event]/presence

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/command-center/[org]/[event]/presence/route.ts](../../apps/web/src/app/api/command-center/[org]/[event]/presence/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/alerts, @yayatoh/assistance, @yayatoh/auth, @yayatoh/campaigns, @yayatoh/checkin, @yayatoh/command-center, @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/notifications, @yayatoh/platform, @yayatoh/reports, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [command-center.ts](../../apps/web/src/server/command-center.ts), [conference-sources.ts](../../apps/web/src/server/conference-sources.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: def, getEventBySlugQuery, reportPresenceCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/csp-report

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/csp-report/route.ts](../../apps/web/src/app/api/csp-report/route.ts).
- Direct domain imports: @yayatoh/platform/security.
- Connected packages: @yayatoh/platform, @yayatoh/platform/security.
- Server files: [rate-limit.ts](../../apps/web/src/server/rate-limit.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/donations/screen/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/donations/screen/[token]/route.ts](../../apps/web/src/app/api/donations/screen/[token]/route.ts).
- Direct domain imports: @yayatoh/donations, @yayatoh/platform.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/email-preview/[org]/[id]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/email-preview/[org]/[id]/route.ts](../../apps/web/src/app/api/email-preview/[org]/[id]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: emailPreviewQuery.
- Direct guard calls: notFound.

### web /api/engagement/display/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/engagement/display/[token]/route.ts](../../apps/web/src/app/api/engagement/display/[token]/route.ts).
- Direct domain imports: @yayatoh/engagement, @yayatoh/platform.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/front-door/not-found

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/front-door/not-found/route.ts](../../apps/web/src/app/api/front-door/not-found/route.ts).
- Direct domain imports: @yayatoh/platform, @yayatoh/platform/front-door.
- Connected packages: @yayatoh/platform, @yayatoh/platform/front-door.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /api/front-door/unavailable/[status]/[locale]

- Type: endpoint.
- Source: [apps/web/src/app/api/front-door/unavailable/[status]/[locale]/route.ts](../../apps/web/src/app/api/front-door/unavailable/[status]/[locale]/route.ts).
- Direct domain imports: @yayatoh/contracts.
- Connected packages: @yayatoh/contracts.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/gallery/direct/[token]

- Type: endpoint (PUT).
- Source: [apps/web/src/app/api/gallery/direct/[token]/route.ts](../../apps/web/src/app/api/gallery/direct/[token]/route.ts).
- Direct domain imports: @yayatoh/gallery, @yayatoh/media.
- Connected packages: @yayatoh/gallery, @yayatoh/media.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/gallery/file/[org]/[item]/[file]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/gallery/file/[org]/[item]/[file]/route.ts](../../apps/web/src/app/api/gallery/file/[org]/[item]/[file]/route.ts).
- Direct domain imports: @yayatoh/gallery.
- Connected packages: @yayatoh/gallery.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: notFound.

### web /api/gallery/stream/[code]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/gallery/stream/[code]/route.ts](../../apps/web/src/app/api/gallery/stream/[code]/route.ts).
- Direct domain imports: @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/health

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/health/route.ts](../../apps/web/src/app/api/health/route.ts).
- Direct domain imports: @yayatoh/db.
- Connected packages: @yayatoh/db.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/internal/revalidate

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/internal/revalidate/route.ts](../../apps/web/src/app/api/internal/revalidate/route.ts).
- Direct domain imports: @yayatoh/platform.
- Connected packages: @yayatoh/platform.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: verifyLinkToken.

### web /api/internal/tls-ask

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/internal/tls-ask/route.ts](../../apps/web/src/app/api/internal/tls-ask/route.ts).
- Direct domain imports: @yayatoh/tenancy.
- Connected packages: @yayatoh/tenancy.
- Server files: none detected.
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/media/upload

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/media/upload/route.ts](../../apps/web/src/app/api/media/upload/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/media.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: verifyUploadTicket.

### web /api/portal-files/[org]/[file]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/portal-files/[org]/[file]/route.ts](../../apps/web/src/app/api/portal-files/[org]/[file]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/media, @yayatoh/tenancy.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: portalFileQuery.
- Direct guard calls: notFound.

### web /api/portal/files

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/portal/files/route.ts](../../apps/web/src/app/api/portal/files/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/media.
- Connected packages: @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: speakerPortalQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/portal/leads/export

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/portal/leads/export/route.ts](../../apps/web/src/app/api/portal/leads/export/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/leads, @yayatoh/platform/http.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/platform/security, @yayatoh/program.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: exportLeadsCommand, speakerPortalQuery.
- Direct guard calls: redirect.

### web /api/portal/logo

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/portal/logo/route.ts](../../apps/web/src/app/api/portal/logo/route.ts).
- Direct domain imports: @yayatoh/events, @yayatoh/kernel, @yayatoh/media.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: speakerPortalQuery.
- Direct guard calls: redirect.

### web /api/realtime/[channel]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/realtime/[channel]/route.ts](../../apps/web/src/app/api/realtime/[channel]/route.ts).
- Direct domain imports: @yayatoh/platform/security.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime-host.ts](../../apps/web/src/server/realtime-host.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/realtime/[channel]/token

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/realtime/[channel]/token/route.ts](../../apps/web/src/app/api/realtime/[channel]/token/route.ts).
- Direct domain imports: @yayatoh/platform, @yayatoh/platform/security.
- Connected packages: @yayatoh/assistance, @yayatoh/auth, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/engagement, @yayatoh/events, @yayatoh/gallery, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/seating, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [realtime-host.ts](../../apps/web/src/server/realtime-host.ts), [realtime.ts](../../apps/web/src/server/realtime.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/assistance/[id]

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/scan/assistance/[id]/route.ts](../../apps/web/src/app/api/scan/assistance/[id]/route.ts).
- Direct domain imports: @yayatoh/assistance, @yayatoh/kernel, @yayatoh/platform/http.
- Connected packages: @yayatoh/assistance, @yayatoh/checkin, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform/http.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: assignCommand, updateCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/assistance

- Type: endpoint (GET, POST).
- Source: [apps/web/src/app/api/scan/assistance/route.ts](../../apps/web/src/app/api/scan/assistance/route.ts).
- Direct domain imports: @yayatoh/assistance, @yayatoh/kernel, @yayatoh/platform/http.
- Connected packages: @yayatoh/assistance, @yayatoh/checkin, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform/http.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: queueQuery, staffRequestCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/guests

- Type: endpoint (GET, POST).
- Source: [apps/web/src/app/api/scan/guests/route.ts](../../apps/web/src/app/api/scan/guests/route.ts).
- Direct domain imports: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/platform/http.
- Connected packages: @yayatoh/checkin, @yayatoh/db, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform/http.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [saved-card.ts](../../apps/web/src/server/saved-card.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: guestSnapshotQuery, recordGuestArrivalsCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/kiosk/badges/pdf

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/scan/kiosk/badges/pdf/route.ts](../../apps/web/src/app/api/scan/kiosk/badges/pdf/route.ts).
- Direct domain imports: @yayatoh/badges, @yayatoh/kernel, @yayatoh/platform/http.
- Connected packages: @yayatoh/badges, @yayatoh/checkin, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform/http.
- Server files: [badge-pdf.ts](../../apps/web/src/server/badge-pdf.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [ports.ts](../../apps/web/src/server/ports.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: kioskJobBadgeQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/kiosk/badges

- Type: endpoint (GET, POST).
- Source: [apps/web/src/app/api/scan/kiosk/badges/route.ts](../../apps/web/src/app/api/scan/kiosk/badges/route.ts).
- Direct domain imports: @yayatoh/badges, @yayatoh/kernel, @yayatoh/platform/http.
- Connected packages: @yayatoh/auth, @yayatoh/badges, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/platform/security, @yayatoh/registration, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [badges.ts](../../apps/web/src/server/badges.ts), [console.ts](../../apps/web/src/server/console.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [guest.ts](../../apps/web/src/server/guest.ts), [kiosk-print.ts](../../apps/web/src/server/kiosk-print.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [org-actor.ts](../../apps/web/src/server/org-actor.ts), [pdf.ts](../../apps/web/src/server/pdf.ts), [personas.ts](../../apps/web/src/server/personas.ts), [ports.ts](../../apps/web/src/server/ports.ts), [printing.ts](../../apps/web/src/server/printing.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [session.ts](../../apps/web/src/server/session.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: badgesSetupQuery, getEventBySlugQuery, getOrganizationQuery, kioskLookupQuery, kioskPrintCommand, kioskRequestCode, kioskSettingsQuery, kioskSnapshotQuery, kioskVerifyCodeCommand, listBatchesQuery, listMediaQuery, printingSetupQuery, teamEventBySlugQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/kiosk/exit

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/scan/kiosk/exit/route.ts](../../apps/web/src/app/api/scan/kiosk/exit/route.ts).
- Direct domain imports: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/platform/http.
- Connected packages: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform/http.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: exitKioskCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/leads/[id]

- Type: endpoint (PATCH).
- Source: [apps/web/src/app/api/scan/leads/[id]/route.ts](../../apps/web/src/app/api/scan/leads/[id]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/leads, @yayatoh/platform/http.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/platform/security, @yayatoh/program.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [scan-leads.ts](../../apps/web/src/server/scan-leads.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: speakerPortalQuery, updateLeadCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/leads

- Type: endpoint (GET, POST).
- Source: [apps/web/src/app/api/scan/leads/route.ts](../../apps/web/src/app/api/scan/leads/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/leads, @yayatoh/platform/http.
- Connected packages: @yayatoh/contracts, @yayatoh/events, @yayatoh/kernel, @yayatoh/leads, @yayatoh/platform, @yayatoh/platform/http, @yayatoh/platform/security, @yayatoh/program.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [portal.ts](../../apps/web/src/server/portal.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [request-origin.ts](../../apps/web/src/server/request-origin.ts), [scan-leads.ts](../../apps/web/src/server/scan-leads.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: leadSetupQuery, myLeadsQuery, speakerPortalQuery, syncLeadScansCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/push

- Type: endpoint (DELETE, GET, POST).
- Source: [apps/web/src/app/api/scan/push/route.ts](../../apps/web/src/app/api/scan/push/route.ts).
- Direct domain imports: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/platform/http.
- Connected packages: @yayatoh/checkin, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform/http.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: staffPushStatusQuery, subscribeStaffPush, unsubscribeStaffPushCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scan/staff

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/scan/staff/route.ts](../../apps/web/src/app/api/scan/staff/route.ts).
- Direct domain imports: @yayatoh/assistance, @yayatoh/checkin, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/http.
- Connected packages: @yayatoh/assistance, @yayatoh/checkin, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/http.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [scan-staff.ts](../../apps/web/src/server/scan-staff.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [web-push.ts](../../apps/web/src/server/web-push.ts).
- Operations in local dependency chain: staffOverview.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/scim/v2/[[...path]]

- Type: endpoint.
- Source: [apps/web/src/app/api/scim/v2/[[...path]]/route.ts](../../apps/web/src/app/api/scim/v2/[[...path]]/route.ts).
- Direct domain imports: @yayatoh/auth, @yayatoh/kernel, @yayatoh/sso.
- Connected packages: @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/sso, @yayatoh/tenancy.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: scimCreateGroupCommand, scimCreateUserCommand, scimDeleteGroupCommand, scimDeleteUserCommand, scimGetGroupQuery, scimGetUserQuery, scimGroupFieldsQuery, scimListGroupsQuery, scimListUsersQuery, scimUpdateGroupCommand, scimUpdateUserCommand, scimUserFieldsQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/tv/[token]

- Type: endpoint (GET).
- Source: [apps/web/src/app/api/tv/[token]/route.ts](../../apps/web/src/app/api/tv/[token]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/command-center, @yayatoh/kernel.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tv.ts](../../apps/web/src/server/tv.ts).
- Operations in local dependency chain: tvBoardQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/unsubscribe/[token]

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/unsubscribe/[token]/route.ts](../../apps/web/src/app/api/unsubscribe/[token]/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/notifications.
- Connected packages: @yayatoh/kernel, @yayatoh/notifications.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: unsubscribeCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/v1/[...path]

- Type: endpoint.
- Source: [apps/web/src/app/api/v1/[...path]/route.ts](../../apps/web/src/app/api/v1/[...path]/route.ts).
- Direct domain imports: @yayatoh/api-v1, @yayatoh/auth.
- Connected packages: @yayatoh/api-v1, @yayatoh/auth, @yayatoh/contracts, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform.
- Server files: [auth.ts](../../apps/web/src/server/auth.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [dev.ts](../../apps/web/src/server/dev.ts), [mail-transports.ts](../../apps/web/src/server/mail-transports.ts), [payments.ts](../../apps/web/src/server/payments.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/virtual/heartbeat

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/virtual/heartbeat/route.ts](../../apps/web/src/app/api/virtual/heartbeat/route.ts).
- Direct domain imports: @yayatoh/kernel, @yayatoh/virtual.
- Connected packages: @yayatoh/kernel, @yayatoh/virtual.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: heartbeatCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/webhooks/billing/[provider]

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/webhooks/billing/[provider]/route.ts](../../apps/web/src/app/api/webhooks/billing/[provider]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/billing, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security.
- Server files: [billing.ts](../../apps/web/src/server/billing.ts), [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/webhooks/email/[provider]

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/webhooks/email/[provider]/route.ts](../../apps/web/src/app/api/webhooks/email/[provider]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [delivery-webhooks.ts](../../apps/web/src/server/delivery-webhooks.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/webhooks/fake

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/webhooks/fake/route.ts](../../apps/web/src/app/api/webhooks/fake/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/donations, @yayatoh/kernel, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [payments.ts](../../apps/web/src/server/payments.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [webhooks.ts](../../apps/web/src/server/webhooks.ts).
- Operations in local dependency chain: applyAccountEventCommand, applyCardSetupCommand, applyDisputeEventCommand, applyProviderEventCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/webhooks/sms/[provider]/inbound

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/webhooks/sms/[provider]/inbound/route.ts](../../apps/web/src/app/api/webhooks/sms/[provider]/inbound/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [delivery-webhooks.ts](../../apps/web/src/server/delivery-webhooks.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/webhooks/sms/[provider]

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/webhooks/sms/[provider]/route.ts](../../apps/web/src/app/api/webhooks/sms/[provider]/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [delivery-webhooks.ts](../../apps/web/src/server/delivery-webhooks.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/webhooks/stripe

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/webhooks/stripe/route.ts](../../apps/web/src/app/api/webhooks/stripe/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/donations, @yayatoh/kernel, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [payments.ts](../../apps/web/src/server/payments.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [webhooks.ts](../../apps/web/src/server/webhooks.ts).
- Operations in local dependency chain: applyAccountEventCommand, applyCardSetupCommand, applyDisputeEventCommand, applyProviderEventCommand.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/webhooks/whatsapp/[provider]

- Type: endpoint (GET, POST).
- Source: [apps/web/src/app/api/webhooks/whatsapp/[provider]/route.ts](../../apps/web/src/app/api/webhooks/whatsapp/[provider]/route.ts).
- Direct domain imports: @yayatoh/notifications.
- Connected packages: @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [delivery-webhooks.ts](../../apps/web/src/server/delivery-webhooks.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [tenant-return.ts](../../apps/web/src/server/tenant-return.ts).
- Operations in local dependency chain: none detected.
- Direct guard calls: none detected; may be enforced by layout or helpers.

### web /api/webhooks/zoom

- Type: endpoint (POST).
- Source: [apps/web/src/app/api/webhooks/zoom/route.ts](../../apps/web/src/app/api/webhooks/zoom/route.ts).
- Direct domain imports: none; local helpers or presentation.
- Connected packages: @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/virtual.
- Server files: [data-subjects.ts](../../apps/web/src/server/data-subjects.ts), [ports.ts](../../apps/web/src/server/ports.ts), [rate-limit.ts](../../apps/web/src/server/rate-limit.ts), [sso-seed.ts](../../apps/web/src/server/sso-seed.ts), [virtual.ts](../../apps/web/src/server/virtual.ts).
- Operations in local dependency chain: watchableTicketsQuery.
- Direct guard calls: none detected; may be enforced by layout or helpers.
