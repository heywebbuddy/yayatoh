CREATE TABLE "program"."cfp_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	CONSTRAINT "cfp_assignments_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "program"."cfp_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."cfp_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."cfp_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"closes_at" timestamp with time zone,
	"blind" boolean DEFAULT false NOT NULL,
	"durations" integer[] DEFAULT '{30,45}'::integer[] NOT NULL,
	"max_co_speakers" integer DEFAULT 3 NOT NULL,
	CONSTRAINT "cfp_calls_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "cfp_calls_status_check" CHECK (status in ('draft', 'open', 'closed')),
	CONSTRAINT "cfp_calls_intro_length_check" CHECK (char_length(intro) <= 4000),
	CONSTRAINT "cfp_calls_durations_check" CHECK (cardinality(durations) between 1 and 8 and 5 <= all(durations) and 480 >= all(durations)),
	CONSTRAINT "cfp_calls_max_co_speakers_check" CHECK (max_co_speakers between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "program"."cfp_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."cfp_calls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."cfp_co_speakers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cfp_co_speakers_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "cfp_co_speakers_name_length_check" CHECK (char_length(name) between 1 and 120),
	CONSTRAINT "cfp_co_speakers_email_check" CHECK (email = lower(email) and char_length(email) between 3 and 254)
);
--> statement-breakpoint
ALTER TABLE "program"."cfp_co_speakers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."cfp_co_speakers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."cfp_reviewers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "cfp_reviewers_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "cfp_reviewers_name_length_check" CHECK (char_length(name) between 1 and 120),
	CONSTRAINT "cfp_reviewers_email_check" CHECK (email = lower(email) and char_length(email) between 3 and 254)
);
--> statement-breakpoint
ALTER TABLE "program"."cfp_reviewers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."cfp_reviewers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."cfp_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	CONSTRAINT "cfp_reviews_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "cfp_reviews_score_check" CHECK (score between 1 and 5),
	CONSTRAINT "cfp_reviews_comment_length_check" CHECK (char_length(comment) <= 2000)
);
--> statement-breakpoint
ALTER TABLE "program"."cfp_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."cfp_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."cfp_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"title" text NOT NULL,
	"abstract" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"track_id" uuid,
	"speaker_name" text NOT NULL,
	"speaker_email" text NOT NULL,
	"speaker_title" text,
	"speaker_company" text,
	"speaker_bio" text DEFAULT '' NOT NULL,
	"locale" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"decision_note" text,
	"speaker_id" uuid,
	"session_id" uuid,
	CONSTRAINT "cfp_submissions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "cfp_submissions_status_check" CHECK (status in ('submitted', 'accepted', 'rejected')),
	CONSTRAINT "cfp_submissions_title_length_check" CHECK (char_length(title) between 1 and 160),
	CONSTRAINT "cfp_submissions_abstract_length_check" CHECK (char_length(abstract) between 1 and 5000),
	CONSTRAINT "cfp_submissions_duration_check" CHECK (duration_minutes between 5 and 480),
	CONSTRAINT "cfp_submissions_email_check" CHECK (speaker_email = lower(speaker_email) and char_length(speaker_email) between 3 and 254),
	CONSTRAINT "cfp_submissions_name_length_check" CHECK (char_length(speaker_name) between 1 and 120),
	CONSTRAINT "cfp_submissions_bio_length_check" CHECK (char_length(speaker_bio) <= 4000),
	CONSTRAINT "cfp_submissions_note_length_check" CHECK (decision_note is null or char_length(decision_note) <= 1000),
	CONSTRAINT "cfp_submissions_decided_check" CHECK ((status = 'submitted') = (decided_at is null))
);
--> statement-breakpoint
ALTER TABLE "program"."cfp_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."cfp_submissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_role_assignments" DROP CONSTRAINT "event_role_assignments_role_check";--> statement-breakpoint
ALTER TABLE "forms"."form_responses" DROP CONSTRAINT "form_responses_respondent_type_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" DROP CONSTRAINT "forms_kind_check";--> statement-breakpoint
ALTER TABLE "events"."portal_accounts" DROP CONSTRAINT "portal_accounts_role_check";--> statement-breakpoint
ALTER TABLE "events"."portal_accounts" DROP CONSTRAINT "portal_accounts_subject_kind_check";--> statement-breakpoint
ALTER TABLE "program"."sessions" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "program"."cfp_assignments" ADD CONSTRAINT "cfp_assignments_submission_fk" FOREIGN KEY ("org_id","submission_id") REFERENCES "program"."cfp_submissions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."cfp_assignments" ADD CONSTRAINT "cfp_assignments_reviewer_fk" FOREIGN KEY ("org_id","reviewer_id") REFERENCES "program"."cfp_reviewers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."cfp_co_speakers" ADD CONSTRAINT "cfp_co_speakers_submission_fk" FOREIGN KEY ("org_id","submission_id") REFERENCES "program"."cfp_submissions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."cfp_reviews" ADD CONSTRAINT "cfp_reviews_assignment_fk" FOREIGN KEY ("org_id","assignment_id") REFERENCES "program"."cfp_assignments"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."cfp_reviews" ADD CONSTRAINT "cfp_reviews_submission_fk" FOREIGN KEY ("org_id","submission_id") REFERENCES "program"."cfp_submissions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."cfp_submissions" ADD CONSTRAINT "cfp_submissions_call_fk" FOREIGN KEY ("org_id","call_id") REFERENCES "program"."cfp_calls"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."cfp_submissions" ADD CONSTRAINT "cfp_submissions_track_fk" FOREIGN KEY ("org_id","track_id") REFERENCES "program"."tracks"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cfp_assignments_org_id_idx" ON "program"."cfp_assignments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cfp_assignments_org_submission_reviewer_key" ON "program"."cfp_assignments" USING btree ("org_id","submission_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "cfp_assignments_org_reviewer_idx" ON "program"."cfp_assignments" USING btree ("org_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "cfp_calls_org_id_idx" ON "program"."cfp_calls" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cfp_calls_org_event_key" ON "program"."cfp_calls" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "cfp_co_speakers_org_id_idx" ON "program"."cfp_co_speakers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cfp_co_speakers_org_submission_email_key" ON "program"."cfp_co_speakers" USING btree ("org_id","submission_id","email");--> statement-breakpoint
CREATE INDEX "cfp_reviewers_org_id_idx" ON "program"."cfp_reviewers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cfp_reviewers_org_event_email_key" ON "program"."cfp_reviewers" USING btree ("org_id","event_id","email");--> statement-breakpoint
CREATE INDEX "cfp_reviews_org_id_idx" ON "program"."cfp_reviews" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cfp_reviews_org_assignment_key" ON "program"."cfp_reviews" USING btree ("org_id","assignment_id");--> statement-breakpoint
CREATE INDEX "cfp_reviews_org_submission_idx" ON "program"."cfp_reviews" USING btree ("org_id","submission_id");--> statement-breakpoint
CREATE INDEX "cfp_submissions_org_id_idx" ON "program"."cfp_submissions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "cfp_submissions_org_event_status_idx" ON "program"."cfp_submissions" USING btree ("org_id","event_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cfp_submissions_org_call_email_title_key" ON "program"."cfp_submissions" USING btree ("org_id","call_id","speaker_email",lower(title));--> statement-breakpoint
CREATE UNIQUE INDEX "cfp_submissions_org_session_key" ON "program"."cfp_submissions" USING btree ("org_id","session_id");--> statement-breakpoint
-- hand-written: begin (M5.3b: a CHECK on an existing table is added NOT VALID, then validated)
ALTER TABLE "events"."event_role_assignments" ADD CONSTRAINT "event_role_assignments_role_check" CHECK (role in ('event_manager', 'door_staff', 'seating_manager', 'session_scanner', 'exhibitor_admin', 'exhibitor_staff', 'speaker', 'sponsor_contact', 'kiosk_operator', 'venue_viewer', 'co_host', 'planner', 'cfp_reviewer')) NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."event_role_assignments" VALIDATE CONSTRAINT "event_role_assignments_role_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M5.3b: a CHECK on an existing table is added NOT VALID, then validated)
ALTER TABLE "forms"."form_responses" ADD CONSTRAINT "form_responses_respondent_type_check" CHECK (respondent_type in ('order', 'survey_invitation', 'form_respondent', 'cfp_submission')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."form_responses" VALIDATE CONSTRAINT "form_responses_respondent_type_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M5.3b: a CHECK on an existing table is added NOT VALID, then validated)
ALTER TABLE "forms"."forms" ADD CONSTRAINT "forms_kind_check" CHECK (kind in ('checkout_questions', 'survey', 'cfp', 'registration')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."forms" VALIDATE CONSTRAINT "forms_kind_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M5.3b: a CHECK on an existing table is added NOT VALID, then validated)
ALTER TABLE "events"."portal_accounts" ADD CONSTRAINT "portal_accounts_role_check" CHECK (role in ('speaker', 'exhibitor_admin', 'exhibitor_staff', 'sponsor_contact', 'cfp_reviewer')) NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."portal_accounts" VALIDATE CONSTRAINT "portal_accounts_role_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M5.3b: a CHECK on an existing table is added NOT VALID, then validated)
ALTER TABLE "events"."portal_accounts" ADD CONSTRAINT "portal_accounts_subject_kind_check" CHECK (subject_kind in ('speaker', 'exhibitor', 'sponsor', 'cfp_reviewer')) NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."portal_accounts" VALIDATE CONSTRAINT "portal_accounts_subject_kind_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "cfp_assignments_tenant_isolation" ON "program"."cfp_assignments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "cfp_calls_tenant_isolation" ON "program"."cfp_calls" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "cfp_co_speakers_tenant_isolation" ON "program"."cfp_co_speakers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "cfp_reviewers_tenant_isolation" ON "program"."cfp_reviewers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "cfp_reviews_tenant_isolation" ON "program"."cfp_reviews" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "cfp_submissions_tenant_isolation" ON "program"."cfp_submissions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));;--> statement-breakpoint
-- hand-written: begin
-- M5.3b: the call-for-papers rows belong to an event of the same org (down the tiers).
ALTER TABLE "program"."cfp_calls" ADD CONSTRAINT "cfp_calls_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."cfp_submissions" ADD CONSTRAINT "cfp_submissions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."cfp_reviewers" ADD CONSTRAINT "cfp_reviewers_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."cfp_assignments" ADD CONSTRAINT "cfp_assignments_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- Deleting the speaker or the session an acceptance created keeps the decision: only the id is cleared.
ALTER TABLE "program"."cfp_submissions" ADD CONSTRAINT "cfp_submissions_speaker_fk" FOREIGN KEY ("org_id","speaker_id") REFERENCES "program"."speakers"("org_id","id") ON DELETE SET NULL ("speaker_id");--> statement-breakpoint
ALTER TABLE "program"."cfp_submissions" ADD CONSTRAINT "cfp_submissions_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE SET NULL ("session_id");
-- hand-written: end
