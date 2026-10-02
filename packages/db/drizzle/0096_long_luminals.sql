CREATE TABLE "events"."portal_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"role" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invite_version" integer DEFAULT 1 NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	CONSTRAINT "portal_accounts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "portal_accounts_role_check" CHECK (role in ('speaker', 'exhibitor_admin', 'exhibitor_staff', 'sponsor_contact')),
	CONSTRAINT "portal_accounts_subject_kind_check" CHECK (subject_kind in ('speaker', 'exhibitor', 'sponsor')),
	CONSTRAINT "portal_accounts_email_check" CHECK (email = lower(email) and char_length(email) between 3 and 254),
	CONSTRAINT "portal_accounts_invite_version_check" CHECK (invite_version between 1 and 999999)
);
--> statement-breakpoint
ALTER TABLE "events"."portal_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."portal_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."portal_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"link_hash" text,
	"browser_hash" text,
	"link_expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	CONSTRAINT "portal_challenges_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "portal_challenges_attempts_check" CHECK (attempts between 0 and 5),
	CONSTRAINT "portal_challenges_link_check" CHECK ((link_hash is null) = (link_expires_at is null) and (link_hash is null or browser_hash is not null))
);
--> statement-breakpoint
ALTER TABLE "events"."portal_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."portal_challenges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"host" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "portal_sessions_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media"."portal_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purpose" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"file_type" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" bigint NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "portal_files_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "portal_files_purpose_check" CHECK (purpose in ('task_answer', 'speaker_photo')),
	CONSTRAINT "portal_files_type_check" CHECK (file_type in ('pdf', 'pptx', 'docx', 'jpeg', 'png', 'webp')),
	CONSTRAINT "portal_files_name_check" CHECK (char_length(file_name) between 1 and 200),
	CONSTRAINT "portal_files_key_check" CHECK (starts_with(storage_key, org_id::text || '/' || id::text || '/f-')),
	CONSTRAINT "portal_files_sha_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "portal_files_bytes_check" CHECK (bytes between 1 and 26214400)
);
--> statement-breakpoint
ALTER TABLE "media"."portal_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."portal_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."portal_task_assignees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"file_id" uuid,
	"file_name" text,
	"reminded_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"overdue_at" timestamp with time zone,
	CONSTRAINT "portal_task_assignees_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "portal_task_assignees_status_check" CHECK (status in ('open', 'done')),
	CONSTRAINT "portal_task_assignees_done_check" CHECK ((status = 'done') = (completed_at is not null)),
	CONSTRAINT "portal_task_assignees_file_name_check" CHECK (file_name is null or char_length(file_name) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "program"."portal_task_assignees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."portal_task_assignees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."portal_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"agreement_text" text,
	"due_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "portal_tasks_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "portal_tasks_subject_kind_check" CHECK (subject_kind in ('speaker', 'exhibitor')),
	CONSTRAINT "portal_tasks_kind_check" CHECK (kind in ('upload', 'agreement', 'confirm')),
	CONSTRAINT "portal_tasks_title_length_check" CHECK (char_length(title) between 1 and 120),
	CONSTRAINT "portal_tasks_instructions_length_check" CHECK (char_length(instructions) <= 2000),
	CONSTRAINT "portal_tasks_agreement_check" CHECK ((kind <> 'agreement' or agreement_text is not null) and (agreement_text is null or char_length(agreement_text) between 1 and 10000))
);
--> statement-breakpoint
ALTER TABLE "program"."portal_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."portal_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."speaker_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"speaker_id" uuid NOT NULL,
	"session_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed" jsonb NOT NULL,
	"base" jsonb NOT NULL,
	"photo_file_id" uuid,
	"submitted_by" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"note" text,
	CONSTRAINT "speaker_changes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "speaker_changes_status_check" CHECK (status in ('pending', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "speaker_changes_note_length_check" CHECK (note is null or char_length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE "program"."speaker_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."speaker_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."portal_accounts" ADD CONSTRAINT "portal_accounts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."portal_accounts" ADD CONSTRAINT "portal_accounts_assignment_fk" FOREIGN KEY ("org_id","assignment_id") REFERENCES "events"."event_role_assignments"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."portal_challenges" ADD CONSTRAINT "portal_challenges_account_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "events"."portal_accounts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" ADD CONSTRAINT "portal_sessions_account_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "events"."portal_accounts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."portal_task_assignees" ADD CONSTRAINT "portal_task_assignees_task_fk" FOREIGN KEY ("org_id","task_id") REFERENCES "program"."portal_tasks"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."speaker_changes" ADD CONSTRAINT "speaker_changes_speaker_fk" FOREIGN KEY ("org_id","speaker_id") REFERENCES "program"."speakers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."speaker_changes" ADD CONSTRAINT "speaker_changes_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_accounts_org_id_idx" ON "events"."portal_accounts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_org_event_role_subject_email_key" ON "events"."portal_accounts" USING btree ("org_id","event_id","role","subject_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_org_assignment_key" ON "events"."portal_accounts" USING btree ("org_id","assignment_id");--> statement-breakpoint
CREATE INDEX "portal_accounts_org_event_subject_idx" ON "events"."portal_accounts" USING btree ("org_id","event_id","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "portal_challenges_org_id_idx" ON "events"."portal_challenges" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "portal_challenges_org_account_idx" ON "events"."portal_challenges" USING btree ("org_id","account_id","created_at");--> statement-breakpoint
CREATE INDEX "portal_sessions_org_id_idx" ON "events"."portal_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_org_token_key" ON "events"."portal_sessions" USING btree ("org_id","token_hash");--> statement-breakpoint
CREATE INDEX "portal_sessions_org_account_idx" ON "events"."portal_sessions" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE INDEX "portal_files_org_id_idx" ON "media"."portal_files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "portal_files_org_owner_idx" ON "media"."portal_files" USING btree ("org_id","owner_id");--> statement-breakpoint
CREATE INDEX "portal_task_assignees_org_id_idx" ON "program"."portal_task_assignees" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_task_assignees_org_task_subject_key" ON "program"."portal_task_assignees" USING btree ("org_id","task_id","subject_id");--> statement-breakpoint
CREATE INDEX "portal_task_assignees_org_subject_idx" ON "program"."portal_task_assignees" USING btree ("org_id","event_id","subject_id");--> statement-breakpoint
CREATE INDEX "portal_task_assignees_org_open_idx" ON "program"."portal_task_assignees" USING btree ("org_id","status","overdue_at");--> statement-breakpoint
CREATE INDEX "portal_tasks_org_id_idx" ON "program"."portal_tasks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "portal_tasks_org_event_due_idx" ON "program"."portal_tasks" USING btree ("org_id","event_id","subject_kind","due_at");--> statement-breakpoint
CREATE INDEX "speaker_changes_org_id_idx" ON "program"."speaker_changes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "speaker_changes_org_event_status_idx" ON "program"."speaker_changes" USING btree ("org_id","event_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_changes_org_pending_key" ON "program"."speaker_changes" USING btree ("org_id","speaker_id",coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'pending';--> statement-breakpoint
CREATE POLICY "portal_accounts_tenant_isolation" ON "events"."portal_accounts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "portal_challenges_tenant_isolation" ON "events"."portal_challenges" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "portal_sessions_tenant_isolation" ON "events"."portal_sessions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "portal_files_tenant_isolation" ON "media"."portal_files" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "portal_task_assignees_tenant_isolation" ON "program"."portal_task_assignees" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "portal_tasks_tenant_isolation" ON "program"."portal_tasks" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "speaker_changes_tenant_isolation" ON "program"."speaker_changes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M5.3a: the speaker portal's program rows belong to an event of the same org (down the tiers).
ALTER TABLE "program"."portal_tasks" ADD CONSTRAINT "portal_tasks_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."portal_task_assignees" ADD CONSTRAINT "portal_task_assignees_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."speaker_changes" ADD CONSTRAINT "speaker_changes_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The overdue sweep (worker, platform_reader): orgs with an open assignee past its task's due date
-- that has not been reported yet. Ids only.
CREATE FUNCTION program.orgs_with_overdue_tasks(p_now timestamptz, p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT a.org_id FROM program.portal_task_assignees a
  JOIN program.portal_tasks t ON t.org_id = a.org_id AND t.id = a.task_id
  WHERE a.status = 'open' AND a.overdue_at IS NULL AND t.due_at <= p_now
  LIMIT p_limit
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION program.orgs_with_overdue_tasks(timestamptz, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION program.orgs_with_overdue_tasks(timestamptz, integer) TO platform_reader;--> statement-breakpoint
-- Portal codes, links and sessions are secrets' hashes: the RLS-bypassing reader never needs them.
REVOKE ALL ON "events"."portal_challenges", "events"."portal_sessions" FROM platform_reader;
-- hand-written: end
