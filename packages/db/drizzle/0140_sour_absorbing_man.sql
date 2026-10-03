CREATE SCHEMA "virtual";
--> statement-breakpoint
CREATE TABLE "checkin"."virtual_attendance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	CONSTRAINT "virtual_attendance_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "checkin"."virtual_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."virtual_attendance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "virtual"."streams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_stream_id" text NOT NULL,
	"playback_id" text NOT NULL,
	"ingest_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "streams_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "streams_provider_check" CHECK (provider in ('fake', 'mux')),
	CONSTRAINT "streams_provider_stream_id_check" CHECK (provider_stream_id ~ '^[A-Za-z0-9_-]{4,100}$'),
	CONSTRAINT "streams_playback_id_check" CHECK (playback_id ~ '^[A-Za-z0-9_]{8,64}$'),
	CONSTRAINT "streams_ingest_url_check" CHECK (ingest_url ~ '^rtmps?://' and char_length(ingest_url) <= 300)
);
--> statement-breakpoint
ALTER TABLE "virtual"."streams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."streams" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "virtual"."ticket_access" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"access" text NOT NULL,
	CONSTRAINT "ticket_access_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "ticket_access_access_check" CHECK (access in ('in_person', 'virtual', 'both'))
);
--> statement-breakpoint
ALTER TABLE "virtual"."ticket_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."ticket_access" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "virtual"."views" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"stream_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"beat_seq" integer DEFAULT 0 NOT NULL,
	"last_beat_at" timestamp with time zone,
	CONSTRAINT "views_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "views_beat_seq_check" CHECK (beat_seq between 0 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "virtual"."views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "virtual"."watch_minutes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"view_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	CONSTRAINT "watch_minutes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "watch_minutes_minute_check" CHECK (date_trunc('minute', minute) = minute)
);
--> statement-breakpoint
ALTER TABLE "virtual"."watch_minutes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."watch_minutes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" DROP CONSTRAINT "checkpoints_kind_check";--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" DROP CONSTRAINT "checkpoints_session_check";--> statement-breakpoint
ALTER TABLE "checkin"."virtual_attendance" ADD CONSTRAINT "virtual_attendance_checkpoint_fk" FOREIGN KEY ("org_id","checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual"."views" ADD CONSTRAINT "views_stream_fk" FOREIGN KEY ("org_id","stream_id") REFERENCES "virtual"."streams"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual"."watch_minutes" ADD CONSTRAINT "watch_minutes_view_fk" FOREIGN KEY ("org_id","view_id") REFERENCES "virtual"."views"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "virtual_attendance_org_id_idx" ON "checkin"."virtual_attendance" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_attendance_org_checkpoint_ticket_key" ON "checkin"."virtual_attendance" USING btree ("org_id","checkpoint_id","ticket_id");--> statement-breakpoint
CREATE INDEX "virtual_attendance_org_event_idx" ON "checkin"."virtual_attendance" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "virtual_attendance_org_ticket_idx" ON "checkin"."virtual_attendance" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE INDEX "streams_org_id_idx" ON "virtual"."streams" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "streams_org_session_key" ON "virtual"."streams" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "streams_org_playback_key" ON "virtual"."streams" USING btree ("org_id","playback_id");--> statement-breakpoint
CREATE INDEX "streams_org_event_idx" ON "virtual"."streams" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "ticket_access_org_id_idx" ON "virtual"."ticket_access" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_access_org_ticket_type_key" ON "virtual"."ticket_access" USING btree ("org_id","ticket_type_id");--> statement-breakpoint
CREATE INDEX "ticket_access_org_event_idx" ON "virtual"."ticket_access" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "views_org_id_idx" ON "virtual"."views" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "views_org_ticket_session_idx" ON "virtual"."views" USING btree ("org_id","ticket_id","session_id");--> statement-breakpoint
CREATE INDEX "views_org_session_idx" ON "virtual"."views" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE INDEX "watch_minutes_org_id_idx" ON "virtual"."watch_minutes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_minutes_org_session_ticket_minute_key" ON "virtual"."watch_minutes" USING btree ("org_id","session_id","ticket_id","minute");--> statement-breakpoint
CREATE INDEX "watch_minutes_org_event_session_idx" ON "virtual"."watch_minutes" USING btree ("org_id","event_id","session_id");--> statement-breakpoint
CREATE INDEX "watch_minutes_org_minute_idx" ON "virtual"."watch_minutes" USING btree ("org_id","minute");--> statement-breakpoint
-- hand-written: begin (M6.9a: a partial unique index on the existing checkin.checkpoints. drizzle's
-- migrator runs each migration in one transaction, so CONCURRENTLY is not possible here: no row
-- matches it yet (kind 'virtual' is new), and on a large table the owner's runbook can create it
-- CONCURRENTLY first under the same name, which IF NOT EXISTS then finds)
CREATE UNIQUE INDEX IF NOT EXISTS "checkpoints_org_virtual_session_key" ON "checkin"."checkpoints" USING btree ("org_id","session_id") WHERE kind = 'virtual';--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M6.9a: two CHECKs widened on the existing checkin.checkpoints for kind
-- 'virtual'; added NOT VALID, then validated)
ALTER TABLE "checkin"."checkpoints" ADD CONSTRAINT "checkpoints_kind_check" CHECK (kind in ('entrance', 'zone', 'session', 'virtual')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD CONSTRAINT "checkpoints_session_check" CHECK ((kind in ('session', 'virtual')) = (session_id is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" VALIDATE CONSTRAINT "checkpoints_kind_check";--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" VALIDATE CONSTRAINT "checkpoints_session_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "virtual_attendance_tenant_isolation" ON "checkin"."virtual_attendance" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "streams_tenant_isolation" ON "virtual"."streams" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "ticket_access_tenant_isolation" ON "virtual"."ticket_access" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "views_tenant_isolation" ON "virtual"."views" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "watch_minutes_tenant_isolation" ON "virtual"."watch_minutes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));;--> statement-breakpoint
-- hand-written: begin
-- M6.9a cross-module FKs, down the tiers (virtual 4 → events 2, ticketing 3, program 3); new
-- tables, so no NOT VALID needed. Deleting an event, ticket type, ticket or session removes its
-- access choice, streams, viewings and watch minutes with it.
ALTER TABLE "virtual"."ticket_access" ADD CONSTRAINT "ticket_access_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."ticket_access" ADD CONSTRAINT "ticket_access_ticket_type_fk" FOREIGN KEY ("org_id","ticket_type_id") REFERENCES "ticketing"."ticket_types"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."streams" ADD CONSTRAINT "streams_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."streams" ADD CONSTRAINT "streams_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."views" ADD CONSTRAINT "views_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."watch_minutes" ADD CONSTRAINT "watch_minutes_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."watch_minutes" ADD CONSTRAINT "watch_minutes_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;
-- hand-written: end
