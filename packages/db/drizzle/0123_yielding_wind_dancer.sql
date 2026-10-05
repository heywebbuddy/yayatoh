CREATE TABLE "seating"."guest_seats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sub_event_id" uuid,
	"guest_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "guest_seats_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "seating"."guest_seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."guest_seats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."vip_tables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "vip_tables_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "seating"."vip_tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."vip_tables" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "guest_seats_org_id_idx" ON "seating"."guest_seats" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_seats_org_event_plan_guest_key" ON "seating"."guest_seats" USING btree ("org_id","event_id","guest_id") WHERE sub_event_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_seats_org_sub_event_guest_key" ON "seating"."guest_seats" USING btree ("org_id","sub_event_id","guest_id") WHERE sub_event_id is not null;--> statement-breakpoint
CREATE INDEX "guest_seats_org_event_item_idx" ON "seating"."guest_seats" USING btree ("org_id","event_id","sub_event_id","item_id");--> statement-breakpoint
CREATE INDEX "guest_seats_org_guest_idx" ON "seating"."guest_seats" USING btree ("org_id","guest_id");--> statement-breakpoint
CREATE INDEX "vip_tables_org_id_idx" ON "seating"."vip_tables" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vip_tables_org_event_item_key" ON "seating"."vip_tables" USING btree ("org_id","event_id","item_id");--> statement-breakpoint
CREATE POLICY "guest_seats_tenant_isolation" ON "seating"."guest_seats" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "vip_tables_tenant_isolation" ON "seating"."vip_tables" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.3a: a guest's place belongs to one event of the org, to a guest of the guests module and,
-- for a sub-event's chart, to a sub-event of that same event (guests is the same tier: a
-- reference only, never an import). Removing the event, the guest or the sub-event removes the
-- places with it. New tables only (migrate.ts sets lock_timeout).
ALTER TABLE "seating"."guest_seats" ADD CONSTRAINT "guest_seats_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."guest_seats" ADD CONSTRAINT "guest_seats_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."guest_seats" ADD CONSTRAINT "guest_seats_sub_event_fk" FOREIGN KEY ("org_id","event_id","sub_event_id") REFERENCES "guests"."sub_events"("org_id","event_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."vip_tables" ADD CONSTRAINT "vip_tables_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
