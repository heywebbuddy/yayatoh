ALTER TABLE "ticketing"."ticket_transfers" ADD COLUMN "to_phone" text;--> statement-breakpoint
CREATE TABLE "ticketing"."event_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"max_attendees" integer NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "event_limits_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_limits_max_check" CHECK (max_attendees between 1 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "ticketing"."event_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."event_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "event_limits_org_id_idx" ON "ticketing"."event_limits" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_limits_org_event_key" ON "ticketing"."event_limits" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "event_limits_tenant_isolation" ON "ticketing"."event_limits" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));