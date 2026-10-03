CREATE TABLE "engagement"."booth_chat_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_by" uuid,
	CONSTRAINT "booth_chat_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "booth_chat_settings_suspended_check" CHECK ((suspended_at is null) = (suspended_by is null))
);
--> statement-breakpoint
ALTER TABLE "engagement"."booth_chat_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."booth_chat_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"profile_a" uuid NOT NULL,
	"profile_b" uuid,
	"exhibitor_id" uuid,
	"started_by" text NOT NULL,
	"a_read_at" timestamp with time zone,
	"b_read_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"blocked_by" text,
	"blocked_at" timestamp with time zone,
	CONSTRAINT "chat_conversations_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "chat_conversations_kind_check" CHECK (kind in ('direct', 'booth')),
	CONSTRAINT "chat_conversations_shape_check" CHECK ((kind = 'direct' and profile_b is not null and exhibitor_id is null and profile_a < profile_b)
        or (kind = 'booth' and profile_b is null and exhibitor_id is not null)),
	CONSTRAINT "chat_conversations_started_by_check" CHECK (started_by in ('a', 'b')),
	CONSTRAINT "chat_conversations_blocked_check" CHECK ((blocked_by is null) = (blocked_at is null) and (blocked_by is null or (kind = 'booth' and blocked_by in ('a', 'b'))))
);
--> statement-breakpoint
ALTER TABLE "engagement"."chat_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."chat_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"sender_account_id" uuid,
	"body" text NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "chat_messages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "chat_messages_sender_check" CHECK (sender in ('a', 'b')),
	CONSTRAINT "chat_messages_body_check" CHECK (char_length(body) between 1 and 2000),
	CONSTRAINT "chat_messages_removed_check" CHECK ((removed_at is null) = (removed_by is null))
);
--> statement-breakpoint
ALTER TABLE "engagement"."chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."chat_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."chat_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reporter" text NOT NULL,
	"reporter_account_id" uuid,
	"reason" text NOT NULL,
	"details" text,
	"moderation" text DEFAULT 'open' NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	CONSTRAINT "chat_reports_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "chat_reports_reporter_check" CHECK (reporter in ('a', 'b')),
	CONSTRAINT "chat_reports_reason_check" CHECK (reason in ('spam', 'harassment', 'inappropriate', 'fake', 'other')),
	CONSTRAINT "chat_reports_details_check" CHECK (details is null or char_length(details) between 1 and 500),
	CONSTRAINT "chat_reports_moderation_check" CHECK (moderation in ('open', 'actioned', 'dismissed')),
	CONSTRAINT "chat_reports_moderated_check" CHECK ((moderation = 'open') = (moderated_at is null)),
	CONSTRAINT "chat_reports_status_check" CHECK (status in ('open', 'resolved', 'dismissed')),
	CONSTRAINT "chat_reports_review_check" CHECK ((status = 'open' and reviewed_at is null) or (status <> 'open' and reviewed_at is not null and reviewed_by is not null and review_note is not null)),
	CONSTRAINT "chat_reports_review_note_check" CHECK (review_note is null or char_length(review_note) between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "engagement"."chat_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."chat_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."network_settings" ADD COLUMN "chat_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "engagement"."chat_conversations" ADD CONSTRAINT "chat_conversations_profile_a_fk" FOREIGN KEY ("org_id","profile_a") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."chat_conversations" ADD CONSTRAINT "chat_conversations_profile_b_fk" FOREIGN KEY ("org_id","profile_b") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."chat_messages" ADD CONSTRAINT "chat_messages_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "engagement"."chat_conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."chat_reports" ADD CONSTRAINT "chat_reports_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "engagement"."chat_conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booth_chat_settings_org_id_idx" ON "engagement"."booth_chat_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booth_chat_settings_org_exhibitor_key" ON "engagement"."booth_chat_settings" USING btree ("org_id","exhibitor_id");--> statement-breakpoint
CREATE INDEX "booth_chat_settings_org_event_idx" ON "engagement"."booth_chat_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "chat_conversations_org_id_idx" ON "engagement"."chat_conversations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_org_direct_key" ON "engagement"."chat_conversations" USING btree ("org_id","profile_a","profile_b") WHERE kind = 'direct';--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_org_booth_key" ON "engagement"."chat_conversations" USING btree ("org_id","profile_a","exhibitor_id") WHERE kind = 'booth';--> statement-breakpoint
CREATE INDEX "chat_conversations_org_a_idx" ON "engagement"."chat_conversations" USING btree ("org_id","profile_a","last_message_at");--> statement-breakpoint
CREATE INDEX "chat_conversations_org_b_idx" ON "engagement"."chat_conversations" USING btree ("org_id","profile_b","last_message_at");--> statement-breakpoint
CREATE INDEX "chat_conversations_org_exhibitor_idx" ON "engagement"."chat_conversations" USING btree ("org_id","exhibitor_id","last_message_at");--> statement-breakpoint
CREATE INDEX "chat_conversations_org_event_idx" ON "engagement"."chat_conversations" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "chat_messages_org_id_idx" ON "engagement"."chat_messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "chat_messages_org_conversation_idx" ON "engagement"."chat_messages" USING btree ("org_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_org_event_idx" ON "engagement"."chat_messages" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_reports_org_id_idx" ON "engagement"."chat_reports" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reports_org_open_key" ON "engagement"."chat_reports" USING btree ("org_id","conversation_id","reporter") WHERE moderation = 'open';--> statement-breakpoint
CREATE INDEX "chat_reports_org_event_idx" ON "engagement"."chat_reports" USING btree ("org_id","event_id","moderation","created_at");--> statement-breakpoint
CREATE INDEX "chat_reports_open_created_idx" ON "engagement"."chat_reports" USING btree ("created_at","org_id") WHERE status = 'open';--> statement-breakpoint
CREATE POLICY "booth_chat_settings_tenant_isolation" ON "engagement"."booth_chat_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "chat_conversations_tenant_isolation" ON "engagement"."chat_conversations" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "chat_messages_tenant_isolation" ON "engagement"."chat_messages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "chat_reports_tenant_isolation" ON "engagement"."chat_reports" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M5.8b cross-module FKs, down the tiers (engagement 5 → events 2, program 3); new tables, so no
-- NOT VALID needed. The new network_settings column is metadata-only (constant default); migrate.ts
-- sets lock_timeout.
ALTER TABLE "engagement"."chat_conversations" ADD CONSTRAINT "chat_conversations_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."chat_conversations" ADD CONSTRAINT "chat_conversations_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."chat_messages" ADD CONSTRAINT "chat_messages_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."chat_reports" ADD CONSTRAINT "chat_reports_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."booth_chat_settings" ADD CONSTRAINT "booth_chat_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."booth_chat_settings" ADD CONSTRAINT "booth_chat_settings_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade;
-- hand-written: end
