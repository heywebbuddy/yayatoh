CREATE SCHEMA "checkin";
--> statement-breakpoint
CREATE TABLE "checkin"."admissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"day" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"admitted_by" uuid,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	CONSTRAINT "admissions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "admissions_day_check" CHECK (day ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."admissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "checkin"."scans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid,
	"admission_id" uuid,
	"result" text NOT NULL,
	"code_kind" text NOT NULL,
	"client_scan_id" text,
	"scanned_at" timestamp with time zone NOT NULL,
	"scanned_by" uuid,
	CONSTRAINT "scans_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "scans_result_check" CHECK (result in ('admitted', 'duplicate', 'invalid', 'void', 'wrong_event', 'not_today', 'outside_window')),
	CONSTRAINT "scans_code_kind_check" CHECK (code_kind in ('yy1', 'short', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "checkin"."scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."scans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "admissions_org_id_idx" ON "checkin"."admissions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_org_ticket_day_live_key" ON "checkin"."admissions" USING btree ("org_id","ticket_id","day") WHERE undone_at is null;--> statement-breakpoint
CREATE INDEX "admissions_org_event_admitted_idx" ON "checkin"."admissions" USING btree ("org_id","event_id","admitted_at");--> statement-breakpoint
CREATE INDEX "scans_org_id_idx" ON "checkin"."scans" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "scans_org_event_scanned_idx" ON "checkin"."scans" USING btree ("org_id","event_id","scanned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scans_org_client_scan_key" ON "checkin"."scans" USING btree ("org_id","client_scan_id") WHERE client_scan_id is not null;--> statement-breakpoint
CREATE POLICY "admissions_tenant_isolation" ON "checkin"."admissions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "scans_tenant_isolation" ON "checkin"."scans" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- Cross-module FKs, hand-written, down the tiers (checkin 4 → ticketing 3, events 2).
ALTER TABLE "checkin"."admissions" ADD CONSTRAINT "admissions_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ADD CONSTRAINT "admissions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_admission_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "checkin"."admissions"("org_id","id");
