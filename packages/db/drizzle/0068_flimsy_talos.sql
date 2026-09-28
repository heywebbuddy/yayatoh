-- M1.13d: the `attendees:write` API key scope (bulk attendee and ticket actions on /v1) and the
-- `restore` status change (the reviewed un-termination). Both CHECKs only widen.
ALTER TABLE "tenancy"."api_keys" DROP CONSTRAINT "api_keys_scopes_check";--> statement-breakpoint
ALTER TABLE "tenancy"."org_status_changes" DROP CONSTRAINT "org_status_changes_action_check";--> statement-breakpoint
-- hand-written: begin (M1.13d: CHECKs on existing tables, NOT VALID then VALIDATE)
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_scopes_check" CHECK (cardinality(scopes) >= 1 and scopes <@ array['org:read', 'events:read', 'events:write', 'orders:read', 'orders:refund', 'attendees:read', 'attendees:write', 'checkin:scan']::text[]) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" VALIDATE CONSTRAINT "api_keys_scopes_check";--> statement-breakpoint
ALTER TABLE "tenancy"."org_status_changes" ADD CONSTRAINT "org_status_changes_action_check" CHECK (action in ('suspend', 'reactivate', 'terminate', 'restore')) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."org_status_changes" VALIDATE CONSTRAINT "org_status_changes_action_check";
-- hand-written: end
