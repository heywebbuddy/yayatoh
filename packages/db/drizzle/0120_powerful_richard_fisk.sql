CREATE TABLE "seating"."channel_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seats" integer NOT NULL,
	"sold_at" timestamp with time zone,
	CONSTRAINT "channel_orders_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "channel_orders_seats_check" CHECK (seats between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "seating"."channel_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."channel_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."channel_seats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"seat_uuid" uuid NOT NULL,
	CONSTRAINT "channel_seats_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "seating"."channel_seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."channel_seats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."layout_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"occurrence_id" uuid,
	"number" integer NOT NULL,
	"kind" text DEFAULT 'save' NOT NULL,
	"restored_from" integer,
	"doc" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"seat_count" integer NOT NULL,
	"actor_id" uuid,
	CONSTRAINT "layout_revisions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "layout_revisions_kind_check" CHECK (kind in ('save', 'restore')),
	CONSTRAINT "layout_revisions_number_check" CHECK (number >= 1),
	CONSTRAINT "layout_revisions_restore_check" CHECK ((kind = 'restore') = (restored_from is not null))
);
--> statement-breakpoint
ALTER TABLE "seating"."layout_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."layout_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."seat_channels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"release_at" timestamp with time zone,
	CONSTRAINT "seat_channels_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "seat_channels_kind_check" CHECK (kind in ('public', 'box_office', 'sponsor', 'promoter')),
	CONSTRAINT "seat_channels_name_length" CHECK (length(name) between 1 and 80),
	CONSTRAINT "seat_channels_code_check" CHECK ((kind in ('sponsor', 'promoter')) = (code is not null) and (code is null or code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'))
);
--> statement-breakpoint
ALTER TABLE "seating"."seat_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."seat_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."channel_orders" ADD CONSTRAINT "channel_orders_channel_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "seating"."seat_channels"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seating"."channel_seats" ADD CONSTRAINT "channel_seats_channel_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "seating"."seat_channels"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_orders_org_id_idx" ON "seating"."channel_orders" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_orders_org_order_key" ON "seating"."channel_orders" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "channel_orders_org_channel_idx" ON "seating"."channel_orders" USING btree ("org_id","channel_id");--> statement-breakpoint
CREATE INDEX "channel_seats_org_id_idx" ON "seating"."channel_seats" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_seats_org_event_seat_key" ON "seating"."channel_seats" USING btree ("org_id","event_id","seat_uuid");--> statement-breakpoint
CREATE INDEX "channel_seats_org_channel_idx" ON "seating"."channel_seats" USING btree ("org_id","channel_id");--> statement-breakpoint
CREATE INDEX "layout_revisions_org_id_idx" ON "seating"."layout_revisions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "layout_revisions_org_event_plan_number_key" ON "seating"."layout_revisions" USING btree ("org_id","event_id","number") WHERE occurrence_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "layout_revisions_org_event_date_number_key" ON "seating"."layout_revisions" USING btree ("org_id","event_id","occurrence_id","number") WHERE occurrence_id is not null;--> statement-breakpoint
CREATE INDEX "seat_channels_org_id_idx" ON "seating"."seat_channels" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "seat_channels_org_event_idx" ON "seating"."seat_channels" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_channels_org_event_code_key" ON "seating"."seat_channels" USING btree ("org_id","event_id","code") WHERE code is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "seat_channels_org_event_kind_key" ON "seating"."seat_channels" USING btree ("org_id","event_id","kind") WHERE kind in ('public', 'box_office');--> statement-breakpoint
CREATE POLICY "channel_orders_tenant_isolation" ON "seating"."channel_orders" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "channel_seats_tenant_isolation" ON "seating"."channel_seats" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "layout_revisions_tenant_isolation" ON "seating"."layout_revisions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "seat_channels_tenant_isolation" ON "seating"."seat_channels" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.11b: channels, allotments, channel orders and layout revisions belong to one event of the
-- org (events is a lower tier: a reference only, never an import) and go with it. A date's
-- revisions go with the date (and removing a date's own chart deletes them too).
ALTER TABLE "seating"."seat_channels" ADD CONSTRAINT "seat_channels_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."channel_seats" ADD CONSTRAINT "channel_seats_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."channel_orders" ADD CONSTRAINT "channel_orders_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."layout_revisions" ADD CONSTRAINT "layout_revisions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."layout_revisions" ADD CONSTRAINT "layout_revisions_occurrence_fk" FOREIGN KEY ("org_id","occurrence_id") REFERENCES "events"."occurrences"("org_id","id") ON DELETE cascade;
-- hand-written: end
