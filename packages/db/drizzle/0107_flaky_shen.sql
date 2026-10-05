CREATE TABLE "guests"."menu_options" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_options_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "menu_options_label_length" CHECK (length(label) between 1 and 80),
	CONSTRAINT "menu_options_notes_length" CHECK (notes is null or length(notes) between 1 and 200),
	CONSTRAINT "menu_options_position_check" CHECK (position >= 0)
);
--> statement-breakpoint
ALTER TABLE "guests"."menu_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."menu_options" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."form_responses" DROP CONSTRAINT "form_responses_respondent_type_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" DROP CONSTRAINT "forms_kind_check";--> statement-breakpoint
CREATE INDEX "menu_options_org_id_idx" ON "guests"."menu_options" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "menu_options_org_event_idx" ON "guests"."menu_options" USING btree ("org_id","event_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_options_org_event_label_key" ON "guests"."menu_options" USING btree ("org_id","event_id",lower("label"));--> statement-breakpoint
ALTER TABLE "forms"."form_responses" ADD CONSTRAINT "form_responses_respondent_type_check" CHECK (respondent_type in ('order', 'survey_invitation', 'form_respondent', 'guest')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."form_responses" VALIDATE CONSTRAINT "form_responses_respondent_type_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" ADD CONSTRAINT "forms_kind_check" CHECK (kind in ('checkout_questions', 'survey', 'registration', 'rsvp')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."forms" VALIDATE CONSTRAINT "forms_kind_check";--> statement-breakpoint
CREATE POLICY "menu_options_tenant_isolation" ON "guests"."menu_options" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.1e cross-module composite FK (guests is tier 3, events tier 2): an event's menu belongs to
-- one event of the org and goes with it.
ALTER TABLE "guests"."menu_options" ADD CONSTRAINT "menu_options_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
