CREATE TABLE "checkin"."reentry_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"hours" integer NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "reentry_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "reentry_settings_hours_check" CHECK (hours between 1 and 72)
);
--> statement-breakpoint
ALTER TABLE "checkin"."reentry_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."reentry_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ADD COLUMN "last_entry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ADD COLUMN "entries" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "reentry_settings_org_id_idx" ON "checkin"."reentry_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reentry_settings_org_event_key" ON "checkin"."reentry_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "reentry_settings_tenant_isolation" ON "checkin"."reentry_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));