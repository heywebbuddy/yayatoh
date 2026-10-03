CREATE TABLE "checkin"."guest_arrivals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"device_id" uuid,
	"recorded_by" uuid,
	"client_id" uuid NOT NULL,
	CONSTRAINT "guest_arrivals_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "guest_arrivals_source_check" CHECK (source in ('scanner', 'kiosk', 'host')),
	CONSTRAINT "guest_arrivals_device_check" CHECK (source <> 'host' or device_id is null)
);
--> statement-breakpoint
ALTER TABLE "checkin"."guest_arrivals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."guest_arrivals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "kiosk_kind" text;--> statement-breakpoint
CREATE INDEX "guest_arrivals_org_id_idx" ON "checkin"."guest_arrivals" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_arrivals_org_guest_key" ON "checkin"."guest_arrivals" USING btree ("org_id","guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_arrivals_org_client_key" ON "checkin"."guest_arrivals" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "guest_arrivals_org_event_at_idx" ON "checkin"."guest_arrivals" USING btree ("org_id","event_id","arrived_at");--> statement-breakpoint
-- hand-written: begin
-- M4.4b: the new CHECK on an existing table is added NOT VALID, then validated (no long lock).
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_kiosk_kind_check" CHECK (kiosk_kind is null or kiosk_kind in ('tickets', 'guests', 'board')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_kiosk_kind_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "guest_arrivals_tenant_isolation" ON "checkin"."guest_arrivals" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.4b: an arrival belongs to an event of the org and to a guest of the guests module (a lower
-- tier: a reference only); removing either removes the arrival. A device that goes keeps the
-- arrival (device_id cleared). New table only (migrate.ts sets lock_timeout).
ALTER TABLE "checkin"."guest_arrivals" ADD CONSTRAINT "guest_arrivals_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "checkin"."guest_arrivals" ADD CONSTRAINT "guest_arrivals_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "checkin"."guest_arrivals" ADD CONSTRAINT "guest_arrivals_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id") ON DELETE SET NULL ("device_id");
-- hand-written: end
