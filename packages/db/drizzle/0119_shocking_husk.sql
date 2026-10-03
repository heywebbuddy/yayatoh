CREATE TABLE "seating"."companion_seats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"seat_uuid" uuid NOT NULL,
	CONSTRAINT "companion_seats_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "seating"."companion_seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."companion_seats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."selection_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"best_available" boolean DEFAULT false NOT NULL,
	"section_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "selection_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "selection_settings_scores_check" CHECK (jsonb_typeof(section_scores) = 'object')
);
--> statement-breakpoint
ALTER TABLE "seating"."selection_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."selection_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."seating_rules" DROP CONSTRAINT "seating_rules_kind_check";--> statement-breakpoint
CREATE INDEX "companion_seats_org_id_idx" ON "seating"."companion_seats" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companion_seats_org_event_seat_key" ON "seating"."companion_seats" USING btree ("org_id","event_id","seat_uuid");--> statement-breakpoint
CREATE INDEX "selection_settings_org_id_idx" ON "seating"."selection_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "selection_settings_org_event_key" ON "seating"."selection_settings" USING btree ("org_id","event_id");--> statement-breakpoint
-- hand-written: begin (M6.11a: the CHECK on the existing seating_rules table added NOT VALID, then validated)
ALTER TABLE "seating"."seating_rules" ADD CONSTRAINT "seating_rules_kind_check" CHECK (kind in ('ada_reserved', 'max_per_order_seats', 'ada_companion')) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."seating_rules" VALIDATE CONSTRAINT "seating_rules_kind_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "companion_seats_tenant_isolation" ON "seating"."companion_seats" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "selection_settings_tenant_isolation" ON "seating"."selection_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.11a: best-available settings and companion seats belong to one event of the org (events is a
-- lower tier: a reference only, never an import) and go with it.
ALTER TABLE "seating"."selection_settings" ADD CONSTRAINT "selection_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."companion_seats" ADD CONSTRAINT "companion_seats_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- P6-13: the `advanced_seating` module key (best available, the ADA engine) is free in beta, so
-- today's plan grants it; a price switches on later with no code change.
INSERT INTO billing.plan_modules (plan_key, module_key) VALUES ('launch_standard', 'advanced_seating') ON CONFLICT DO NOTHING;
-- hand-written: end
