CREATE SCHEMA "ai";
--> statement-breakpoint
CREATE SCHEMA "program";
--> statement-breakpoint
CREATE TABLE "ai"."credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"balance" integer NOT NULL,
	"allowance" integer NOT NULL,
	"period" text NOT NULL,
	CONSTRAINT "credit_accounts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "credit_accounts_balance_check" CHECK (balance >= 0),
	CONSTRAINT "credit_accounts_allowance_check" CHECK (allowance >= 0),
	CONSTRAINT "credit_accounts_period_check" CHECK (period ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "ai"."credit_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."credit_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai"."credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"period" text NOT NULL,
	"reason" text NOT NULL,
	"draft_kind" text,
	"event_id" uuid,
	"ref_id" uuid,
	"actor" text,
	CONSTRAINT "credit_ledger_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "credit_ledger_kind_check" CHECK (kind in ('grant', 'debit', 'refund', 'adjust')),
	CONSTRAINT "credit_ledger_draft_kind_check" CHECK (draft_kind is null or draft_kind in ('tagline', 'description', 'faq')),
	CONSTRAINT "credit_ledger_balance_after_check" CHECK (balance_after >= 0),
	CONSTRAINT "credit_ledger_sign_check" CHECK ((kind = 'debit' and amount < 0) or (kind in ('grant', 'refund') and amount > 0) or kind = 'adjust')
);
--> statement-breakpoint
ALTER TABLE "ai"."credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."credit_ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."exhibitors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"booth_label" text,
	"website_url" text,
	CONSTRAINT "exhibitors_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "exhibitors_name_length_check" CHECK (char_length(name) between 1 and 120),
	CONSTRAINT "exhibitors_website_check" CHECK (website_url is null or website_url ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "program"."exhibitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."exhibitors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."rooms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	CONSTRAINT "rooms_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "rooms_name_length_check" CHECK (char_length(name) between 1 and 80),
	CONSTRAINT "rooms_capacity_check" CHECK (capacity is null or capacity >= 1)
);
--> statement-breakpoint
ALTER TABLE "program"."rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."rooms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."session_speakers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid NOT NULL,
	"speaker_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "session_speakers_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "program"."session_speakers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."session_speakers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"occurrence_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"room_id" uuid,
	"track_id" uuid,
	"capacity" integer,
	CONSTRAINT "sessions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sessions_time_order_check" CHECK (ends_at > starts_at),
	CONSTRAINT "sessions_title_length_check" CHECK (char_length(title) between 1 and 160),
	CONSTRAINT "sessions_capacity_check" CHECK (capacity is null or capacity >= 1)
);
--> statement-breakpoint
ALTER TABLE "program"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."speakers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"company" text,
	"bio" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "speakers_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "speakers_name_length_check" CHECK (char_length(name) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "program"."speakers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."speakers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sponsor_tiers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "sponsor_tiers_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sponsor_tiers_name_length_check" CHECK (char_length(name) between 1 and 60),
	CONSTRAINT "sponsor_tiers_position_check" CHECK (position between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "program"."sponsor_tiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sponsor_tiers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sponsors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"website_url" text,
	CONSTRAINT "sponsors_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sponsors_name_length_check" CHECK (char_length(name) between 1 and 120),
	CONSTRAINT "sponsors_website_check" CHECK (website_url is null or website_url ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "program"."sponsors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sponsors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."tracks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tracks_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "tracks_name_length_check" CHECK (char_length(name) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "program"."tracks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."tracks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."session_speakers" ADD CONSTRAINT "session_speakers_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."session_speakers" ADD CONSTRAINT "session_speakers_speaker_fk" FOREIGN KEY ("org_id","speaker_id") REFERENCES "program"."speakers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sessions" ADD CONSTRAINT "sessions_room_fk" FOREIGN KEY ("org_id","room_id") REFERENCES "program"."rooms"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sessions" ADD CONSTRAINT "sessions_track_fk" FOREIGN KEY ("org_id","track_id") REFERENCES "program"."tracks"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sponsors" ADD CONSTRAINT "sponsors_tier_fk" FOREIGN KEY ("org_id","tier_id") REFERENCES "program"."sponsor_tiers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_accounts_org_id_idx" ON "ai"."credit_accounts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_accounts_org_key" ON "ai"."credit_accounts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_id_idx" ON "ai"."credit_ledger" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_created_idx" ON "ai"."credit_ledger" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_org_refund_key" ON "ai"."credit_ledger" USING btree ("org_id","ref_id") WHERE kind = 'refund';--> statement-breakpoint
CREATE INDEX "exhibitors_org_id_idx" ON "program"."exhibitors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "exhibitors_org_event_name_idx" ON "program"."exhibitors" USING btree ("org_id","event_id","name");--> statement-breakpoint
CREATE INDEX "rooms_org_id_idx" ON "program"."rooms" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_org_event_name_key" ON "program"."rooms" USING btree ("org_id","event_id",lower(name));--> statement-breakpoint
CREATE INDEX "session_speakers_org_id_idx" ON "program"."session_speakers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_speakers_org_session_speaker_key" ON "program"."session_speakers" USING btree ("org_id","session_id","speaker_id");--> statement-breakpoint
CREATE INDEX "session_speakers_org_speaker_idx" ON "program"."session_speakers" USING btree ("org_id","speaker_id");--> statement-breakpoint
CREATE INDEX "sessions_org_id_idx" ON "program"."sessions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sessions_org_event_starts_idx" ON "program"."sessions" USING btree ("org_id","event_id","starts_at");--> statement-breakpoint
CREATE INDEX "sessions_org_room_idx" ON "program"."sessions" USING btree ("org_id","room_id");--> statement-breakpoint
CREATE INDEX "sessions_org_track_idx" ON "program"."sessions" USING btree ("org_id","track_id");--> statement-breakpoint
CREATE INDEX "speakers_org_id_idx" ON "program"."speakers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "speakers_org_event_name_idx" ON "program"."speakers" USING btree ("org_id","event_id","name");--> statement-breakpoint
CREATE INDEX "sponsor_tiers_org_id_idx" ON "program"."sponsor_tiers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_tiers_org_event_name_key" ON "program"."sponsor_tiers" USING btree ("org_id","event_id",lower(name));--> statement-breakpoint
CREATE INDEX "sponsor_tiers_org_event_position_idx" ON "program"."sponsor_tiers" USING btree ("org_id","event_id","position");--> statement-breakpoint
CREATE INDEX "sponsors_org_id_idx" ON "program"."sponsors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sponsors_org_event_tier_idx" ON "program"."sponsors" USING btree ("org_id","event_id","tier_id");--> statement-breakpoint
CREATE INDEX "tracks_org_id_idx" ON "program"."tracks" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_org_event_name_key" ON "program"."tracks" USING btree ("org_id","event_id",lower(name));--> statement-breakpoint
CREATE POLICY "credit_accounts_tenant_isolation" ON "ai"."credit_accounts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "credit_ledger_tenant_isolation" ON "ai"."credit_ledger" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "exhibitors_tenant_isolation" ON "program"."exhibitors" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "rooms_tenant_isolation" ON "program"."rooms" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_speakers_tenant_isolation" ON "program"."session_speakers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sessions_tenant_isolation" ON "program"."sessions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "speakers_tenant_isolation" ON "program"."speakers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sponsor_tiers_tenant_isolation" ON "program"."sponsor_tiers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sponsors_tenant_isolation" ON "program"."sponsors" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "tracks_tenant_isolation" ON "program"."tracks" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin
-- M1.4f cross-module composite FKs (program is tier 3, events tier 2): every program row belongs to one event of the org.
ALTER TABLE "program"."tracks" ADD CONSTRAINT "tracks_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."rooms" ADD CONSTRAINT "rooms_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."sessions" ADD CONSTRAINT "sessions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."speakers" ADD CONSTRAINT "speakers_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."exhibitors" ADD CONSTRAINT "exhibitors_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."sponsor_tiers" ADD CONSTRAINT "sponsor_tiers_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."sponsors" ADD CONSTRAINT "sponsors_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- A session may belong to one date of a multi-date event (M1.4b occurrences are cancelled, never deleted).
ALTER TABLE "program"."sessions" ADD CONSTRAINT "sessions_occurrence_fk" FOREIGN KEY ("org_id","occurrence_id") REFERENCES "events"."occurrences"("org_id","id") ON DELETE no action;--> statement-breakpoint
CREATE INDEX "sessions_org_occurrence_idx" ON "program"."sessions" USING btree ("org_id","occurrence_id") WHERE occurrence_id IS NOT NULL;--> statement-breakpoint
-- The AI credit ledger is append-only for the runtime role.
REVOKE UPDATE, DELETE, TRUNCATE ON "ai"."credit_ledger" FROM app_user;
-- hand-written: end
