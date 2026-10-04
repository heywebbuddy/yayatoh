CREATE TABLE "templates"."template_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"template_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "template_events_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "templates"."template_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates"."template_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."event_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	CONSTRAINT "event_checklist_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_checklist_items_title_check" CHECK (char_length(title) between 1 and 200),
	CONSTRAINT "event_checklist_items_position_check" CHECK (position >= 0)
);
--> statement-breakpoint
ALTER TABLE "events"."event_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_checklist_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates"."event_templates" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "templates"."template_events" ADD CONSTRAINT "template_events_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "templates"."event_templates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."event_checklist_items" ADD CONSTRAINT "event_checklist_items_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_events_org_id_idx" ON "templates"."template_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_events_org_event_key" ON "templates"."template_events" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "template_events_org_template_idx" ON "templates"."template_events" USING btree ("org_id","template_id","created_at");--> statement-breakpoint
CREATE INDEX "event_checklist_items_org_id_idx" ON "events"."event_checklist_items" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "event_checklist_items_org_event_position_idx" ON "events"."event_checklist_items" USING btree ("org_id","event_id","position");--> statement-breakpoint
CREATE POLICY "template_events_tenant_isolation" ON "templates"."template_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_checklist_items_tenant_isolation" ON "events"."event_checklist_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- U6: a template's event link belongs to one event of the org (composite FK; a deleted event drops its link).
ALTER TABLE "templates"."template_events" ADD CONSTRAINT "template_events_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
