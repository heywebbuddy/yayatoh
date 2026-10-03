-- M6.5c: personal calendar connections (a registrant's own Google Calendar push) and the
-- `webhooks:manage` API key scope (Make and n8n instant triggers subscribe over /v1).
ALTER TABLE "tenancy"."api_keys" DROP CONSTRAINT "api_keys_scopes_check";--> statement-breakpoint
ALTER TABLE "integrations"."connections" ADD COLUMN "registrant_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations"."connections" ADD COLUMN "event_id" uuid;--> statement-breakpoint
-- hand-written: begin (M6.5c: the new live-slot index exists before the old one goes; CHECKs NOT VALID then VALIDATE)
CREATE UNIQUE INDEX "connections_org_connector_subject_live_key" ON "integrations"."connections" USING btree ("org_id","connector",coalesce(registrant_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status in ('pending', 'active', 'paused');--> statement-breakpoint
DROP INDEX "integrations"."connections_org_connector_live_key";--> statement-breakpoint
CREATE INDEX "connections_org_registrant_idx" ON "integrations"."connections" USING btree ("org_id","registrant_id") WHERE registrant_id is not null;--> statement-breakpoint
ALTER TABLE "integrations"."connections" ADD CONSTRAINT "connections_subject_check" CHECK ((registrant_id is null) = (event_id is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "integrations"."connections" VALIDATE CONSTRAINT "connections_subject_check";--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_scopes_check" CHECK (cardinality(scopes) >= 1 and scopes <@ array['org:read', 'events:read', 'events:write', 'orders:read', 'orders:refund', 'attendees:read', 'attendees:write', 'checkin:scan', 'webhooks:manage']::text[]) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" VALIDATE CONSTRAINT "api_keys_scopes_check";
-- hand-written: end
