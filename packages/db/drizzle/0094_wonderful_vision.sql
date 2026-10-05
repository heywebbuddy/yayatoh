CREATE TABLE "seating"."sub_event_charts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sub_event_id" uuid NOT NULL,
	"source_layout_id" uuid,
	"doc" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"seat_count" integer NOT NULL,
	CONSTRAINT "sub_event_charts_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "seating"."sub_event_charts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."sub_event_charts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "sub_event_charts_org_id_idx" ON "seating"."sub_event_charts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_event_charts_org_sub_event_key" ON "seating"."sub_event_charts" USING btree ("org_id","sub_event_id");--> statement-breakpoint
CREATE INDEX "sub_event_charts_org_event_idx" ON "seating"."sub_event_charts" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "sub_event_charts_tenant_isolation" ON "seating"."sub_event_charts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.1c: a sub-event's own chart belongs to one event of the org and to a sub-event of that same
-- event (guests.sub_events, same tier: a reference only, never an import); both take it with them.
ALTER TABLE "seating"."sub_event_charts" ADD CONSTRAINT "sub_event_charts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."sub_event_charts" ADD CONSTRAINT "sub_event_charts_sub_event_fk" FOREIGN KEY ("org_id","event_id","sub_event_id") REFERENCES "guests"."sub_events"("org_id","event_id","id") ON DELETE cascade;
-- hand-written: end
