CREATE TABLE "checkin"."checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"ticket_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "checkpoints_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "checkpoints_kind_check" CHECK (kind in ('entrance', 'zone'))
);
--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "checkin"."fraud_signals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ticket_id" uuid,
	"checkpoint_id" uuid,
	"device_id" uuid,
	"user_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fraud_signals_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "fraud_signals_kind_check" CHECK (kind in ('two_entrances', 'invalid_burst'))
);
--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ADD COLUMN "checkpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD COLUMN "checkpoint_id" uuid;--> statement-breakpoint
CREATE INDEX "checkpoints_org_id_idx" ON "checkin"."checkpoints" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_org_event_name_key" ON "checkin"."checkpoints" USING btree ("org_id","event_id","name");--> statement-breakpoint
CREATE INDEX "fraud_signals_org_id_idx" ON "checkin"."fraud_signals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "fraud_signals_org_event_raised_idx" ON "checkin"."fraud_signals" USING btree ("org_id","event_id","raised_at");--> statement-breakpoint
-- Widen the result check without a long lock: add the new one NOT VALID, validate, drop the old.
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_result_check_v2" CHECK (result in ('admitted', 'duplicate', 'invalid', 'void', 'wrong_event', 'not_today', 'outside_window', 'duplicate_offline', 'superseded', 'provisional', 'granted', 'no_access')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_result_check_v2";--> statement-breakpoint
ALTER TABLE "checkin"."scans" DROP CONSTRAINT "scans_result_check";--> statement-breakpoint
ALTER TABLE "checkin"."scans" RENAME CONSTRAINT "scans_result_check_v2" TO "scans_result_check";--> statement-breakpoint
CREATE POLICY "checkpoints_tenant_isolation" ON "checkin"."checkpoints" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "fraud_signals_tenant_isolation" ON "checkin"."fraud_signals" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD CONSTRAINT "checkpoints_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_checkpoint_fk" FOREIGN KEY ("org_id","checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ADD CONSTRAINT "admissions_checkpoint_fk" FOREIGN KEY ("org_id","checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."admissions" VALIDATE CONSTRAINT "admissions_checkpoint_fk";--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_checkpoint_fk" FOREIGN KEY ("org_id","checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_checkpoint_fk";
