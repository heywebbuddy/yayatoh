CREATE SCHEMA "command_center";
--> statement-breakpoint
CREATE TABLE "command_center"."layouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"widget_order" text[] DEFAULT '{}'::text[] NOT NULL,
	"hidden_widgets" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "layouts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "layouts_size_check" CHECK (cardinality(widget_order) <= 32 and cardinality(hidden_widgets) <= 32)
);
--> statement-breakpoint
ALTER TABLE "command_center"."layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "command_center"."layouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "command_center"."mode_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mode_overrides_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "mode_overrides_mode_check" CHECK (mode in ('planning', 'pre_show', 'live', 'wrap'))
);
--> statement-breakpoint
ALTER TABLE "command_center"."mode_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "command_center"."mode_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "layouts_org_id_idx" ON "command_center"."layouts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "layouts_org_event_user_key" ON "command_center"."layouts" USING btree ("org_id","event_id","user_id");--> statement-breakpoint
CREATE INDEX "layouts_org_user_idx" ON "command_center"."layouts" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "mode_overrides_org_id_idx" ON "command_center"."mode_overrides" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mode_overrides_org_event_key" ON "command_center"."mode_overrides" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "layouts_tenant_isolation" ON "command_center"."layouts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "mode_overrides_tenant_isolation" ON "command_center"."mode_overrides" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M3.2a: layouts and mode overrides belong to one event of the org (composite FKs; a deleted event takes them).
ALTER TABLE "command_center"."layouts" ADD CONSTRAINT "layouts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "command_center"."mode_overrides" ADD CONSTRAINT "mode_overrides_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- A member's layout is theirs alone: the org's membership (composite FK; leaving the org removes it).
ALTER TABLE "command_center"."layouts" ADD CONSTRAINT "layouts_member_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "tenancy"."memberships"("org_id","user_id") ON DELETE cascade;
-- hand-written: end
