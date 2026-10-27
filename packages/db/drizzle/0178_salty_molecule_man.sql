CREATE TABLE "events"."event_pickup_points" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"minutes_before" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_pickup_points_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_pickup_points_name_check" CHECK (char_length(name) between 1 and 80),
	CONSTRAINT "event_pickup_points_address_check" CHECK (char_length(address) <= 200),
	CONSTRAINT "event_pickup_points_minutes_check" CHECK (minutes_before between 0 and 720),
	CONSTRAINT "event_pickup_points_position_check" CHECK (position >= 0)
);
--> statement-breakpoint
ALTER TABLE "events"."event_pickup_points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_pickup_points" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."events" DROP CONSTRAINT "events_profile_check";--> statement-breakpoint
ALTER TABLE "events"."event_pickup_points" ADD CONSTRAINT "event_pickup_points_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_pickup_points_org_id_idx" ON "events"."event_pickup_points" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "event_pickup_points_org_event_position_idx" ON "events"."event_pickup_points" USING btree ("org_id","event_id","position");--> statement-breakpoint
ALTER TABLE "events"."events" ADD CONSTRAINT "events_profile_check" CHECK (profile in ('wedding', 'gala', 'concert', 'conference', 'community', 'tour', 'agency', 'other'));--> statement-breakpoint
CREATE POLICY "event_pickup_points_tenant_isolation" ON "events"."event_pickup_points" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));