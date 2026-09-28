CREATE TABLE "checkin"."detection_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"max_scans_per_minute" integer NOT NULL,
	"max_travel_kmh" integer NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "detection_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "detection_settings_rate_check" CHECK (max_scans_per_minute between 2 and 600),
	CONSTRAINT "detection_settings_travel_check" CHECK (max_travel_kmh between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "checkin"."detection_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."detection_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "severity" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "events"."event_role_assignments" ADD COLUMN "checkpoint_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE INDEX "detection_settings_org_id_idx" ON "checkin"."detection_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "detection_settings_org_event_key" ON "checkin"."detection_settings" USING btree ("org_id","event_id");--> statement-breakpoint
-- hand-written: begin
-- Checks on existing tables: NOT VALID, then VALIDATE (no long lock). Widened checks are added
-- as *_v2, validated, the old one dropped and the new one renamed (as in 0020).
ALTER TABLE "checkin"."checkpoints" ADD CONSTRAINT "checkpoints_location_check" CHECK ((latitude is null) = (longitude is null) and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" VALIDATE CONSTRAINT "checkpoints_location_check";--> statement-breakpoint
-- Existing signals get the severity their kind has now (two_entrances is high).
UPDATE "checkin"."fraud_signals" SET "severity" = 'high' WHERE "kind" = 'two_entrances';--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_severity_check" CHECK (severity in ('low', 'medium', 'high')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_severity_check";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_status_check" CHECK (status in ('open', 'acknowledged', 'dismissed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_status_check";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_resolved_check" CHECK ((status = 'open') = (resolved_at is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_resolved_check";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_kind_check_v2" CHECK (kind in ('two_entrances', 'invalid_burst', 'device_velocity', 'impossible_travel', 'rejected_burst')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_kind_check_v2";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" DROP CONSTRAINT "fraud_signals_kind_check";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" RENAME CONSTRAINT "fraud_signals_kind_check_v2" TO "fraud_signals_kind_check";--> statement-breakpoint
-- Merged with M1.4b (0043): the widened list keeps wrong_date and adds wrong_checkpoint.
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_result_check_v2" CHECK (result in ('admitted', 'duplicate', 'invalid', 'void', 'wrong_event', 'not_today', 'outside_window', 'wrong_date', 'duplicate_offline', 'superseded', 'provisional', 'granted', 'no_access', 'wrong_checkpoint')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_result_check_v2";--> statement-breakpoint
ALTER TABLE "checkin"."scans" DROP CONSTRAINT "scans_result_check";--> statement-breakpoint
ALTER TABLE "checkin"."scans" RENAME CONSTRAINT "scans_result_check_v2" TO "scans_result_check";--> statement-breakpoint
-- Detection settings belong to one event (FK down the tiers; modules never import each other's schema).
ALTER TABLE "checkin"."detection_settings" ADD CONSTRAINT "detection_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
-- hand-written: end
CREATE POLICY "detection_settings_tenant_isolation" ON "checkin"."detection_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));