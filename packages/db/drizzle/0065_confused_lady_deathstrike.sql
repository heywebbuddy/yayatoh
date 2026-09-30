CREATE SCHEMA "surveys";
--> statement-breakpoint
CREATE TABLE "surveys"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"survey_id" uuid NOT NULL,
	"send_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"remind_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	CONSTRAINT "invitations_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "invitations_expiry_check" CHECK (expires_at > created_at)
);
--> statement-breakpoint
ALTER TABLE "surveys"."invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "surveys"."invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "surveys"."responses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"survey_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"form_version" integer NOT NULL,
	CONSTRAINT "responses_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "responses_form_version_check" CHECK (form_version >= 1)
);
--> statement-breakpoint
ALTER TABLE "surveys"."responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "surveys"."responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "surveys"."sends" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"survey_id" uuid NOT NULL,
	"source" text DEFAULT 'console' NOT NULL,
	"audience" text NOT NULL,
	"reminder_days" integer,
	"link_days" integer NOT NULL,
	"recipients" integer NOT NULL,
	"sent_by" uuid,
	CONSTRAINT "sends_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sends_source_check" CHECK (source in ('console', 'journey')),
	CONSTRAINT "sends_audience_check" CHECK (audience in ('all', 'checked_in')),
	CONSTRAINT "sends_reminder_days_check" CHECK (reminder_days is null or reminder_days between 1 and 30),
	CONSTRAINT "sends_link_days_check" CHECK (link_days between 1 and 90),
	CONSTRAINT "sends_recipients_check" CHECK (recipients >= 0)
);
--> statement-breakpoint
ALTER TABLE "surveys"."sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "surveys"."sends" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "surveys"."surveys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"session_id" uuid,
	"title" text NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "surveys_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "surveys_kind_check" CHECK (kind in ('post_event', 'session_feedback')),
	CONSTRAINT "surveys_session_check" CHECK ((kind = 'session_feedback') = (session_id is not null)),
	CONSTRAINT "surveys_title_check" CHECK (char_length(title) between 1 and 120),
	CONSTRAINT "surveys_intro_check" CHECK (char_length(intro) <= 500)
);
--> statement-breakpoint
ALTER TABLE "surveys"."surveys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "surveys"."surveys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."form_responses" DROP CONSTRAINT "form_responses_respondent_type_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" DROP CONSTRAINT "forms_kind_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" DROP CONSTRAINT "forms_subject_type_check";--> statement-breakpoint
ALTER TABLE "surveys"."invitations" ADD CONSTRAINT "invitations_survey_fk" FOREIGN KEY ("org_id","survey_id") REFERENCES "surveys"."surveys"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys"."invitations" ADD CONSTRAINT "invitations_send_fk" FOREIGN KEY ("org_id","send_id") REFERENCES "surveys"."sends"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys"."responses" ADD CONSTRAINT "responses_survey_fk" FOREIGN KEY ("org_id","survey_id") REFERENCES "surveys"."surveys"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys"."responses" ADD CONSTRAINT "responses_invitation_fk" FOREIGN KEY ("org_id","invitation_id") REFERENCES "surveys"."invitations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys"."sends" ADD CONSTRAINT "sends_survey_fk" FOREIGN KEY ("org_id","survey_id") REFERENCES "surveys"."surveys"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_org_id_idx" ON "surveys"."invitations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_org_survey_contact_key" ON "surveys"."invitations" USING btree ("org_id","survey_id","contact_id");--> statement-breakpoint
CREATE INDEX "invitations_org_survey_responded_idx" ON "surveys"."invitations" USING btree ("org_id","survey_id","responded_at");--> statement-breakpoint
CREATE INDEX "invitations_org_send_idx" ON "surveys"."invitations" USING btree ("org_id","send_id");--> statement-breakpoint
CREATE INDEX "invitations_org_attendee_idx" ON "surveys"."invitations" USING btree ("org_id","attendee_id");--> statement-breakpoint
CREATE INDEX "responses_org_id_idx" ON "surveys"."responses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_org_survey_contact_key" ON "surveys"."responses" USING btree ("org_id","survey_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_org_invitation_key" ON "surveys"."responses" USING btree ("org_id","invitation_id");--> statement-breakpoint
CREATE INDEX "responses_org_survey_created_idx" ON "surveys"."responses" USING btree ("org_id","survey_id","created_at");--> statement-breakpoint
CREATE INDEX "sends_org_id_idx" ON "surveys"."sends" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sends_org_survey_idx" ON "surveys"."sends" USING btree ("org_id","survey_id","created_at");--> statement-breakpoint
CREATE INDEX "surveys_org_id_idx" ON "surveys"."surveys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "surveys_org_event_idx" ON "surveys"."surveys" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "surveys_org_event_post_event_key" ON "surveys"."surveys" USING btree ("org_id","event_id") WHERE kind = 'post_event';--> statement-breakpoint
CREATE UNIQUE INDEX "surveys_org_session_key" ON "surveys"."surveys" USING btree ("org_id","session_id") WHERE session_id is not null;--> statement-breakpoint
-- hand-written: begin
-- Widened CHECKs on existing forms tables (M3.9a surveys): NOT VALID + VALIDATE keeps the lock short.
ALTER TABLE "forms"."form_responses" ADD CONSTRAINT "form_responses_respondent_type_check" CHECK (respondent_type in ('order', 'survey_invitation')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."form_responses" VALIDATE CONSTRAINT "form_responses_respondent_type_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" ADD CONSTRAINT "forms_kind_check" CHECK (kind in ('checkout_questions', 'survey')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."forms" VALIDATE CONSTRAINT "forms_kind_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" ADD CONSTRAINT "forms_subject_type_check" CHECK (subject_type in ('event', 'survey')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."forms" VALIDATE CONSTRAINT "forms_subject_type_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "invitations_tenant_isolation" ON "surveys"."invitations" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "responses_tenant_isolation" ON "surveys"."responses" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sends_tenant_isolation" ON "surveys"."sends" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "surveys_tenant_isolation" ON "surveys"."surveys" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (surveys 5 → events 2, program 3, attendees 2); new tables, so no NOT VALID needed.
ALTER TABLE "surveys"."surveys" ADD CONSTRAINT "surveys_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "surveys"."surveys" ADD CONSTRAINT "surveys_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "surveys"."invitations" ADD CONSTRAINT "invitations_attendee_fk" FOREIGN KEY ("org_id","attendee_id") REFERENCES "attendees"."attendees"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
-- Survey links: invitation id (from a verified HMAC token) → its org. Ids only. Only live orgs
-- (M1.3f, like ticketing.claim_org): a suspended or terminated org's survey links are not found.
CREATE FUNCTION surveys.invitation_org(p_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT i.org_id FROM surveys.invitations i
  JOIN tenancy.organizations o ON o.id = i.org_id AND o.status IN ('active', 'limited')
  WHERE i.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION surveys.invitation_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION surveys.invitation_org(uuid) TO app_user;
-- hand-written: end
