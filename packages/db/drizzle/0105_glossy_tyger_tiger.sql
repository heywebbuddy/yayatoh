CREATE SCHEMA "engagement";
--> statement-breakpoint
CREATE TABLE "engagement"."poll_ballots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"poll_id" uuid NOT NULL,
	"participant_key" text NOT NULL,
	CONSTRAINT "poll_ballots_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "poll_ballots_participant_key_check" CHECK (char_length(participant_key) between 20 and 64)
);
--> statement-breakpoint
ALTER TABLE "engagement"."poll_ballots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."poll_ballots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."poll_tallies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"poll_id" uuid NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "poll_tallies_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "poll_tallies_key_check" CHECK (char_length(key) between 1 and 40),
	CONSTRAINT "poll_tallies_count_check" CHECK (count >= 0)
);
--> statement-breakpoint
ALTER TABLE "engagement"."poll_tallies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."poll_tallies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."polls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_choices" integer DEFAULT 1 NOT NULL,
	"rating_scale" integer,
	"state" text DEFAULT 'draft' NOT NULL,
	"show_results" boolean DEFAULT false NOT NULL,
	"ballots" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "polls_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "polls_kind_check" CHECK (kind in ('single', 'multi', 'rating', 'word_cloud')),
	CONSTRAINT "polls_state_check" CHECK (state in ('draft', 'open', 'closed')),
	CONSTRAINT "polls_question_check" CHECK (char_length(question) between 1 and 200),
	CONSTRAINT "polls_max_choices_check" CHECK (max_choices between 1 and 10),
	CONSTRAINT "polls_rating_scale_check" CHECK ((kind = 'rating') = (rating_scale is not null) and (rating_scale is null or rating_scale between 3 and 10)),
	CONSTRAINT "polls_ballots_check" CHECK (ballots >= 0),
	CONSTRAINT "polls_options_check" CHECK (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 10)
);
--> statement-breakpoint
ALTER TABLE "engagement"."polls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."polls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."question_upvotes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question_id" uuid NOT NULL,
	"participant_key" text NOT NULL,
	CONSTRAINT "question_upvotes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "question_upvotes_participant_key_check" CHECK (char_length(participant_key) between 20 and 64)
);
--> statement-breakpoint
ALTER TABLE "engagement"."question_upvotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."question_upvotes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_name" text,
	"anonymous" boolean DEFAULT false NOT NULL,
	"participant_key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by" uuid,
	"answered_at" timestamp with time zone,
	CONSTRAINT "questions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "questions_state_check" CHECK (state in ('pending', 'approved', 'dismissed')),
	CONSTRAINT "questions_body_check" CHECK (char_length(body) between 1 and 300),
	CONSTRAINT "questions_author_name_check" CHECK (author_name is null or char_length(author_name) between 1 and 60),
	CONSTRAINT "questions_upvotes_check" CHECK (upvotes >= 0),
	CONSTRAINT "questions_answered_check" CHECK (answered_at is null or state = 'approved'),
	CONSTRAINT "questions_participant_key_check" CHECK (char_length(participant_key) between 20 and 64)
);
--> statement-breakpoint
ALTER TABLE "engagement"."questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."questions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."session_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"qa_open" boolean DEFAULT true NOT NULL,
	"allow_anonymous" boolean DEFAULT true NOT NULL,
	"anonymous_identity" text DEFAULT 'hidden' NOT NULL,
	"display_version" integer DEFAULT 1 NOT NULL,
	"live_poll_id" uuid,
	"pinned_question_id" uuid,
	CONSTRAINT "session_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "session_settings_identity_check" CHECK (anonymous_identity in ('hidden', 'moderators')),
	CONSTRAINT "session_settings_display_version_check" CHECK (display_version >= 1)
);
--> statement-breakpoint
ALTER TABLE "engagement"."session_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."session_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."poll_ballots" ADD CONSTRAINT "poll_ballots_poll_fk" FOREIGN KEY ("org_id","poll_id") REFERENCES "engagement"."polls"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."poll_tallies" ADD CONSTRAINT "poll_tallies_poll_fk" FOREIGN KEY ("org_id","poll_id") REFERENCES "engagement"."polls"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."question_upvotes" ADD CONSTRAINT "question_upvotes_question_fk" FOREIGN KEY ("org_id","question_id") REFERENCES "engagement"."questions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_ballots_org_id_idx" ON "engagement"."poll_ballots" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_ballots_org_poll_participant_key" ON "engagement"."poll_ballots" USING btree ("org_id","poll_id","participant_key");--> statement-breakpoint
CREATE INDEX "poll_tallies_org_id_idx" ON "engagement"."poll_tallies" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_tallies_org_poll_key_key" ON "engagement"."poll_tallies" USING btree ("org_id","poll_id","key");--> statement-breakpoint
CREATE INDEX "polls_org_id_idx" ON "engagement"."polls" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "polls_org_session_idx" ON "engagement"."polls" USING btree ("org_id","session_id","created_at");--> statement-breakpoint
CREATE INDEX "polls_org_event_idx" ON "engagement"."polls" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "question_upvotes_org_id_idx" ON "engagement"."question_upvotes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_upvotes_org_question_participant_key" ON "engagement"."question_upvotes" USING btree ("org_id","question_id","participant_key");--> statement-breakpoint
CREATE INDEX "questions_org_id_idx" ON "engagement"."questions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "questions_org_session_state_idx" ON "engagement"."questions" USING btree ("org_id","session_id","state","created_at");--> statement-breakpoint
CREATE INDEX "questions_org_session_participant_idx" ON "engagement"."questions" USING btree ("org_id","session_id","participant_key","created_at");--> statement-breakpoint
CREATE INDEX "questions_org_event_idx" ON "engagement"."questions" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "session_settings_org_id_idx" ON "engagement"."session_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_settings_org_session_key" ON "engagement"."session_settings" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE INDEX "session_settings_org_event_idx" ON "engagement"."session_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "poll_ballots_tenant_isolation" ON "engagement"."poll_ballots" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "poll_tallies_tenant_isolation" ON "engagement"."poll_tallies" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "polls_tenant_isolation" ON "engagement"."polls" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "question_upvotes_tenant_isolation" ON "engagement"."question_upvotes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "questions_tenant_isolation" ON "engagement"."questions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_settings_tenant_isolation" ON "engagement"."session_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (engagement 5 → events 2, program 3); new tables, so no NOT VALID needed.
ALTER TABLE "engagement"."session_settings" ADD CONSTRAINT "session_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."session_settings" ADD CONSTRAINT "session_settings_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."polls" ADD CONSTRAINT "polls_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."polls" ADD CONSTRAINT "polls_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."questions" ADD CONSTRAINT "questions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."questions" ADD CONSTRAINT "questions_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
-- Big-screen links (M5.7a): org + session from a verified HMAC token → the session's event and
-- current display version. Ids and the version only; only live orgs (like events.public_event_target).
CREATE FUNCTION engagement.display_target(p_org uuid, p_session uuid)
RETURNS TABLE (event_id uuid, display_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.event_id, s.display_version FROM engagement.session_settings s
  JOIN tenancy.organizations o ON o.id = s.org_id AND o.status IN ('active', 'limited')
  WHERE s.org_id = p_org AND s.session_id = p_session
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION engagement.display_target(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION engagement.display_target(uuid, uuid) TO app_user;
-- hand-written: end
