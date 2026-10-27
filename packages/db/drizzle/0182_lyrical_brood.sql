CREATE TABLE "engagement"."lobby_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"body" text NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "lobby_messages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "lobby_messages_body_check" CHECK (char_length(body) between 1 and 2000),
	CONSTRAINT "lobby_messages_removed_check" CHECK ((removed_at is null) = (removed_by is null))
);
--> statement-breakpoint
ALTER TABLE "engagement"."lobby_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."lobby_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."lobby_reads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lobby_reads_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "engagement"."lobby_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."lobby_reads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."lobby_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"moderation" text DEFAULT 'open' NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by" uuid,
	CONSTRAINT "lobby_reports_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "lobby_reports_reason_check" CHECK (reason in ('spam', 'harassment', 'inappropriate', 'fake', 'other')),
	CONSTRAINT "lobby_reports_details_check" CHECK (details is null or char_length(details) between 1 and 500),
	CONSTRAINT "lobby_reports_moderation_check" CHECK (moderation in ('open', 'actioned', 'dismissed')),
	CONSTRAINT "lobby_reports_moderated_check" CHECK ((moderation = 'open') = (moderated_at is null))
);
--> statement-breakpoint
ALTER TABLE "engagement"."lobby_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."lobby_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."network_settings" ADD COLUMN "lobby_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events"."events" ADD COLUMN "show_attendee_count" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "engagement"."lobby_messages" ADD CONSTRAINT "lobby_messages_profile_fk" FOREIGN KEY ("org_id","profile_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."lobby_reads" ADD CONSTRAINT "lobby_reads_profile_fk" FOREIGN KEY ("org_id","profile_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."lobby_reports" ADD CONSTRAINT "lobby_reports_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "engagement"."lobby_messages"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."lobby_reports" ADD CONSTRAINT "lobby_reports_reporter_fk" FOREIGN KEY ("org_id","reporter_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lobby_messages_org_id_idx" ON "engagement"."lobby_messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lobby_messages_org_event_idx" ON "engagement"."lobby_messages" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "lobby_messages_org_profile_idx" ON "engagement"."lobby_messages" USING btree ("org_id","profile_id","created_at");--> statement-breakpoint
CREATE INDEX "lobby_reads_org_id_idx" ON "engagement"."lobby_reads" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lobby_reads_org_profile_key" ON "engagement"."lobby_reads" USING btree ("org_id","profile_id");--> statement-breakpoint
CREATE INDEX "lobby_reports_org_id_idx" ON "engagement"."lobby_reports" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lobby_reports_org_open_key" ON "engagement"."lobby_reports" USING btree ("org_id","message_id","reporter_id") WHERE moderation = 'open';--> statement-breakpoint
CREATE INDEX "lobby_reports_org_event_idx" ON "engagement"."lobby_reports" USING btree ("org_id","event_id","moderation","created_at");--> statement-breakpoint
CREATE POLICY "lobby_messages_tenant_isolation" ON "engagement"."lobby_messages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "lobby_reads_tenant_isolation" ON "engagement"."lobby_reads" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "lobby_reports_tenant_isolation" ON "engagement"."lobby_reports" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));