CREATE TABLE "seating"."solver_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"strength" text DEFAULT 'soft' NOT NULL,
	"weight" integer DEFAULT 5 NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "solver_rules_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "solver_rules_kind_check" CHECK (kind in ('keep_together', 'keep_apart', 'vip_near_stage', 'access_near_exit', 'table_max')),
	CONSTRAINT "solver_rules_strength_check" CHECK (strength in ('hard', 'soft')),
	CONSTRAINT "solver_rules_weight_check" CHECK (weight between 1 and 10),
	CONSTRAINT "solver_rules_params_check" CHECK (jsonb_typeof(params) = 'object')
);
--> statement-breakpoint
ALTER TABLE "seating"."solver_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."solver_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "solver_rules_org_id_idx" ON "seating"."solver_rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "solver_rules_org_event_idx" ON "seating"."solver_rules" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE POLICY "solver_rules_tenant_isolation" ON "seating"."solver_rules" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.12a: a solver rule belongs to one event of the org and goes with it. New table only
-- (migrate.ts sets lock_timeout).
ALTER TABLE "seating"."solver_rules" ADD CONSTRAINT "solver_rules_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- P6-13: the `ai_seating` module key (seating rules and the solver) is free in beta, so the
-- launch plan grants it; prices switch on later with no code change.
INSERT INTO billing.plan_modules (plan_key, module_key) VALUES ('launch_standard', 'ai_seating') ON CONFLICT DO NOTHING;
-- hand-written: end
