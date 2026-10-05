CREATE TABLE "registration"."enrollment_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"promotion" text DEFAULT 'auto' NOT NULL,
	"offer_minutes" integer DEFAULT 240 NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "enrollment_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "enrollment_settings_promotion_check" CHECK (promotion in ('auto', 'offer')),
	CONSTRAINT "enrollment_settings_offer_minutes_check" CHECK (offer_minutes between 15 and 2880)
);
--> statement-breakpoint
ALTER TABLE "registration"."enrollment_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."enrollment_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."item_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"admission_item_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	CONSTRAINT "item_sessions_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "registration"."item_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."item_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."session_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"registrant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"position_at" timestamp with time zone NOT NULL,
	"enrolled_at" timestamp with time zone,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"offer_count" integer DEFAULT 0 NOT NULL,
	"promoted_by" text,
	"skip_reason" text,
	"picked" boolean DEFAULT false NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "session_enrollments_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "session_enrollments_status_check" CHECK (status in ('enrolled', 'waiting', 'offered', 'dropped', 'left', 'expired', 'declined', 'skipped', 'cancelled')),
	CONSTRAINT "session_enrollments_offer_check" CHECK ((status = 'offered') = (offer_expires_at is not null and offered_at is not null)),
	CONSTRAINT "session_enrollments_skip_check" CHECK ((status = 'skipped') = (skip_reason is not null) and (skip_reason is null or skip_reason in ('overlap', 'one_per_group', 'not_available', 'registrant_gone'))),
	CONSTRAINT "session_enrollments_promoted_check" CHECK (promoted_by is null or promoted_by in ('auto', 'offer', 'organizer')),
	CONSTRAINT "session_enrollments_offer_count_check" CHECK (offer_count >= 0)
);
--> statement-breakpoint
ALTER TABLE "registration"."session_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."session_enrollments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."item_sessions" ADD CONSTRAINT "item_sessions_item_fk" FOREIGN KEY ("org_id","admission_item_id") REFERENCES "registration"."admission_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollment_settings_org_id_idx" ON "registration"."enrollment_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_settings_org_event_key" ON "registration"."enrollment_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "item_sessions_org_id_idx" ON "registration"."item_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_sessions_org_item_session_key" ON "registration"."item_sessions" USING btree ("org_id","admission_item_id","session_id");--> statement-breakpoint
CREATE INDEX "item_sessions_org_event_idx" ON "registration"."item_sessions" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "item_sessions_org_session_idx" ON "registration"."item_sessions" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE INDEX "session_enrollments_org_id_idx" ON "registration"."session_enrollments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_enrollments_org_live_key" ON "registration"."session_enrollments" USING btree ("org_id","session_id","registrant_id") WHERE status in ('enrolled', 'waiting', 'offered');--> statement-breakpoint
CREATE INDEX "session_enrollments_org_queue_idx" ON "registration"."session_enrollments" USING btree ("org_id","session_id","status","position_at","id");--> statement-breakpoint
CREATE INDEX "session_enrollments_org_registrant_idx" ON "registration"."session_enrollments" USING btree ("org_id","registrant_id");--> statement-breakpoint
CREATE INDEX "session_enrollments_org_event_idx" ON "registration"."session_enrollments" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "session_enrollments_org_order_idx" ON "registration"."session_enrollments" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "session_enrollments_org_offer_idx" ON "registration"."session_enrollments" USING btree ("org_id","offer_expires_at") WHERE status = 'offered';--> statement-breakpoint
CREATE POLICY "enrollment_settings_tenant_isolation" ON "registration"."enrollment_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "item_sessions_tenant_isolation" ON "registration"."item_sessions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_enrollments_tenant_isolation" ON "registration"."session_enrollments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M5.2b cross-module composite FKs, down the tiers (registration 5 → orders 4, program 3, ticketing 3, events 2); new tables, so no NOT VALID needed.
ALTER TABLE "registration"."item_sessions" ADD CONSTRAINT "item_sessions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."item_sessions" ADD CONSTRAINT "item_sessions_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."enrollment_settings" ADD CONSTRAINT "enrollment_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."session_enrollments" ADD CONSTRAINT "session_enrollments_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."session_enrollments" ADD CONSTRAINT "session_enrollments_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."session_enrollments" ADD CONSTRAINT "session_enrollments_registrant_fk" FOREIGN KEY ("org_id","registrant_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."session_enrollments" ADD CONSTRAINT "session_enrollments_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE cascade;
-- hand-written: end
