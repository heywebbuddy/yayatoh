CREATE TABLE "virtual"."zoom_participant_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"webinar_link_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"participant_key" text NOT NULL,
	"ticket_id" uuid,
	"email" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "zoom_participant_events_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "zoom_participant_events_kind_check" CHECK (kind in ('joined', 'left')),
	CONSTRAINT "zoom_participant_events_provider_event_id_check" CHECK (provider_event_id ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "zoom_participant_events_participant_key_check" CHECK (participant_key ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "zoom_participant_events_email_check" CHECK (email is null or char_length(email) <= 320)
);
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_participant_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_participant_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."streams" DROP CONSTRAINT "streams_provider_check";--> statement-breakpoint
ALTER TABLE "virtual"."streams" ADD COLUMN "backup_ingest_url" text;--> statement-breakpoint
ALTER TABLE "virtual"."streams" ADD COLUMN "active_ingest" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual"."watch_minutes" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_attendance" ADD COLUMN "segment_key" text;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_webinars" ADD COLUMN "origin" text DEFAULT 'linked' NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_participant_events" ADD CONSTRAINT "zoom_participant_events_webinar_fk" FOREIGN KEY ("org_id","webinar_link_id") REFERENCES "virtual"."zoom_webinars"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zoom_participant_events_org_id_idx" ON "virtual"."zoom_participant_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zoom_participant_events_org_provider_event_key" ON "virtual"."zoom_participant_events" USING btree ("org_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "zoom_participant_events_org_webinar_participant_idx" ON "virtual"."zoom_participant_events" USING btree ("org_id","webinar_link_id","participant_key","at");--> statement-breakpoint
CREATE INDEX "zoom_participant_events_org_event_idx" ON "virtual"."zoom_participant_events" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "zoom_participant_events_org_ticket_idx" ON "virtual"."zoom_participant_events" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "zoom_attendance_org_webinar_segment_key" ON "virtual"."zoom_attendance" USING btree ("org_id","webinar_link_id","segment_key");--> statement-breakpoint
ALTER TABLE "virtual"."streams" ADD CONSTRAINT "streams_backup_ingest_url_check" CHECK (backup_ingest_url is null or (backup_ingest_url ~ '^rtmps?://' and char_length(backup_ingest_url) <= 300)) NOT VALID;--> statement-breakpoint
ALTER TABLE "virtual"."streams" VALIDATE CONSTRAINT "streams_backup_ingest_url_check";--> statement-breakpoint
ALTER TABLE "virtual"."streams" ADD CONSTRAINT "streams_active_ingest_check" CHECK (active_ingest = 'primary' or (active_ingest = 'backup' and backup_ingest_url is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "virtual"."streams" VALIDATE CONSTRAINT "streams_active_ingest_check";--> statement-breakpoint
ALTER TABLE "virtual"."streams" ADD CONSTRAINT "streams_provider_check" CHECK (provider in ('fake', 'mux', 'fake_cloudflare', 'cloudflare')) NOT VALID;--> statement-breakpoint
ALTER TABLE "virtual"."streams" VALIDATE CONSTRAINT "streams_provider_check";--> statement-breakpoint
ALTER TABLE "virtual"."watch_minutes" ADD CONSTRAINT "watch_minutes_provider_check" CHECK (provider is null or provider in ('fake', 'mux', 'fake_cloudflare', 'cloudflare')) NOT VALID;--> statement-breakpoint
ALTER TABLE "virtual"."watch_minutes" VALIDATE CONSTRAINT "watch_minutes_provider_check";--> statement-breakpoint
ALTER TABLE "virtual"."zoom_attendance" ADD CONSTRAINT "zoom_attendance_segment_key_check" CHECK (segment_key is null or segment_key ~ '^[0-9a-f]{64}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_attendance" VALIDATE CONSTRAINT "zoom_attendance_segment_key_check";--> statement-breakpoint
ALTER TABLE "virtual"."zoom_webinars" ADD CONSTRAINT "zoom_webinars_origin_check" CHECK (origin in ('linked', 'created')) NOT VALID;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_webinars" VALIDATE CONSTRAINT "zoom_webinars_origin_check";--> statement-breakpoint
CREATE POLICY "zoom_participant_events_tenant_isolation" ON "virtual"."zoom_participant_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.10a. CHECKs on the existing virtual tables above are NOT VALID + VALIDATE (a brief lock), and
-- the unique index on zoom_attendance is IF NOT EXISTS so a runbook can build it CONCURRENTLY first
-- (drizzle's migrator runs each migration in one transaction). Cross-module FKs of the new table,
-- down the tiers (virtual 4 → events 2, program 3, ticketing 3): deleting an event or session
-- removes its webhook rows; a deleted ticket leaves them pointing at no one.
ALTER TABLE "virtual"."zoom_participant_events" ADD CONSTRAINT "zoom_participant_events_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_participant_events" ADD CONSTRAINT "zoom_participant_events_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_participant_events" ADD CONSTRAINT "zoom_participant_events_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE SET NULL ("ticket_id");
--> statement-breakpoint
-- The org a Zoom webinar belongs to (the join/leave webhook resolves the webinar id in the body,
-- after verifying its signature). A webinar Yayatoh created through an org's Zoom connection wins:
-- only that account got the id from Zoom. Otherwise the one org that linked the id. Null when
-- none, or when the id is ambiguous. Returns the org id only.
CREATE FUNCTION virtual.org_for_zoom_webinar(p_webinar text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN count(*) FILTER (WHERE w.origin = 'created') = 1
      THEN (min(w.org_id::text) FILTER (WHERE w.origin = 'created'))::uuid
    WHEN count(*) FILTER (WHERE w.origin = 'created') = 0 AND count(*) = 1
      THEN (min(w.org_id::text))::uuid
  END
  FROM virtual.zoom_webinars w
  WHERE w.webinar_id = p_webinar
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION virtual.org_for_zoom_webinar(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION virtual.org_for_zoom_webinar(text) TO app_user;
-- hand-written: end
