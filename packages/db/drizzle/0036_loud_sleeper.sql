CREATE SCHEMA "seating";
--> statement-breakpoint
CREATE TABLE "seating"."event_layouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"source_layout_id" uuid,
	"doc" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"seat_count" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "event_layouts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_layouts_status_check" CHECK (status in ('draft', 'published', 'locked'))
);
--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."event_seats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"seat_uuid" uuid NOT NULL,
	"label" text NOT NULL,
	"item_id" uuid NOT NULL,
	"section_id" uuid,
	"ticket_type_id" uuid,
	"accessible" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"hold_id" uuid,
	"hold_expires_at" timestamp with time zone,
	"ticket_id" uuid,
	"block_reason" text,
	CONSTRAINT "event_seats_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_seats_status_check" CHECK (status in ('available', 'held', 'sold', 'blocked')),
	CONSTRAINT "event_seats_block_check" CHECK ((status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in ('channel', 'ada', 'kill'))),
	CONSTRAINT "event_seats_hold_check" CHECK ((status = 'held') = (hold_id is not null and hold_expires_at is not null)),
	CONSTRAINT "event_seats_sold_check" CHECK ((status = 'sold') = (ticket_id is not null))
);
--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."layouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"doc" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"seat_count" integer NOT NULL,
	CONSTRAINT "layouts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "layouts_name_length" CHECK (length(name) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "seating"."layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."layouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "event_layouts_org_id_idx" ON "seating"."event_layouts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_layouts_org_event_key" ON "seating"."event_layouts" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "event_seats_org_id_idx" ON "seating"."event_seats" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_seats_org_event_seat_key" ON "seating"."event_seats" USING btree ("org_id","event_id","seat_uuid");--> statement-breakpoint
CREATE INDEX "event_seats_org_event_status_idx" ON "seating"."event_seats" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "event_seats_org_hold_idx" ON "seating"."event_seats" USING btree ("org_id","hold_id");--> statement-breakpoint
CREATE INDEX "layouts_org_id_idx" ON "seating"."layouts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "layouts_org_name_idx" ON "seating"."layouts" USING btree ("org_id","name");--> statement-breakpoint
CREATE POLICY "event_layouts_tenant_isolation" ON "seating"."event_layouts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_seats_tenant_isolation" ON "seating"."event_seats" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "layouts_tenant_isolation" ON "seating"."layouts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));