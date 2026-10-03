CREATE TABLE "checkin"."session_attendance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"in_at" timestamp with time zone NOT NULL,
	"out_at" timestamp with time zone,
	"source" text DEFAULT 'scan' NOT NULL,
	"in_by" uuid,
	"in_device_id" uuid,
	"out_device_id" uuid,
	"offline" boolean DEFAULT false NOT NULL,
	"override_gates" text[] DEFAULT '{}'::text[] NOT NULL,
	"override_reason" text,
	CONSTRAINT "session_attendance_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "session_attendance_out_check" CHECK (out_at is null or out_at >= in_at),
	CONSTRAINT "session_attendance_source_check" CHECK (source in ('scan', 'override', 'self')),
	CONSTRAINT "session_attendance_override_check" CHECK (override_gates <@ array['enrollment', 'admission_level', 'capacity']::text[] and (source = 'override') = (cardinality(override_gates) > 0) and (override_reason is null) = (source <> 'override') and (override_reason is null or char_length(override_reason) between 3 and 300))
);
--> statement-breakpoint
ALTER TABLE "checkin"."session_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."session_attendance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" DROP CONSTRAINT "checkpoints_kind_check";--> statement-breakpoint
ALTER TABLE "checkin"."scans" DROP CONSTRAINT "scans_result_check";--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD COLUMN "self_checkin_token" text;--> statement-breakpoint
ALTER TABLE "checkin"."session_attendance" ADD CONSTRAINT "session_attendance_checkpoint_fk" FOREIGN KEY ("org_id","checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_attendance_org_id_idx" ON "checkin"."session_attendance" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_attendance_org_open_key" ON "checkin"."session_attendance" USING btree ("org_id","session_id","ticket_id") WHERE out_at is null;--> statement-breakpoint
CREATE INDEX "session_attendance_org_session_in_idx" ON "checkin"."session_attendance" USING btree ("org_id","session_id","in_at");--> statement-breakpoint
CREATE INDEX "session_attendance_org_event_idx" ON "checkin"."session_attendance" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "session_attendance_org_ticket_idx" ON "checkin"."session_attendance" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_self_checkin_token_key" ON "checkin"."checkpoints" USING btree ("self_checkin_token") WHERE self_checkin_token is not null;--> statement-breakpoint
CREATE INDEX "checkpoints_org_session_idx" ON "checkin"."checkpoints" USING btree ("org_id","session_id") WHERE session_id is not null;--> statement-breakpoint
-- hand-written: begin (M5.6a: CHECKs on existing tables (checkpoints, scans) added NOT VALID, then validated)
ALTER TABLE "checkin"."checkpoints" ADD CONSTRAINT "checkpoints_session_check" CHECK ((kind = 'session') = (session_id is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD CONSTRAINT "checkpoints_self_checkin_check" CHECK (self_checkin_token is null or (kind = 'session' and self_checkin_token ~ '^[A-Za-z0-9_-]{32}$')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD CONSTRAINT "checkpoints_kind_check" CHECK (kind in ('entrance', 'zone', 'session')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_result_check" CHECK (result in ('admitted', 'duplicate', 'invalid', 'void', 'wrong_event', 'not_today', 'outside_window', 'wrong_date', 'duplicate_offline', 'superseded', 'provisional', 'granted', 'no_access', 'wrong_checkpoint', 'balance_due', 'entered', 'scanned_out', 'not_in_room', 'not_enrolled', 'admission_level', 'capacity')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" VALIDATE CONSTRAINT "checkpoints_session_check";--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" VALIDATE CONSTRAINT "checkpoints_self_checkin_check";--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" VALIDATE CONSTRAINT "checkpoints_kind_check";--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_result_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M5.6a: a self check-in flyer's token resolves to (org, checkpoint) before any tenant is known; live session doors of active orgs only, allowlisted columns)
CREATE FUNCTION checkin.self_checkin_door(p_token text)
RETURNS TABLE (org_id uuid, checkpoint_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT c.org_id, c.id
  FROM checkin.checkpoints c
  JOIN tenancy.organizations o ON o.id = c.org_id AND o.status IN ('active', 'limited')
  WHERE c.self_checkin_token = p_token AND c.kind = 'session' AND c.archived_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION checkin.self_checkin_door(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION checkin.self_checkin_door(text) TO app_user;
--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M5.6a: cross-module foreign keys, down the tiers: checkin 4 → ticketing 3, events 2; a new table, so validated at once)
ALTER TABLE "checkin"."session_attendance" ADD CONSTRAINT "session_attendance_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."session_attendance" ADD CONSTRAINT "session_attendance_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
-- hand-written: end
CREATE POLICY "session_attendance_tenant_isolation" ON "checkin"."session_attendance" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));