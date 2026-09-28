CREATE TABLE "notifications"."address_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"address_norm" text NOT NULL,
	"reason" text NOT NULL,
	"message_id" uuid,
	CONSTRAINT "address_suppressions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "address_suppressions_channel_check" CHECK (channel in ('email', 'sms')),
	CONSTRAINT "address_suppressions_reason_check" CHECK (reason in ('hard_bounce', 'soft_bounce', 'complaint')),
	CONSTRAINT "address_suppressions_address_check" CHECK ((channel = 'email' and address_norm = lower(btrim(address_norm)) and address_norm like '%@%') or (channel = 'sms' and address_norm ~ '^\+[0-9]{6,15}$'))
);
--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."email_previews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"html" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_previews_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "email_previews_html_length" CHECK (length(html) between 1 and 524288)
);
--> statement-breakpoint
ALTER TABLE "notifications"."email_previews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."email_previews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."message_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"bounce_type" text,
	"detail" text,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_events_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "message_events_type_check" CHECK (type in ('delivered', 'bounced', 'complained')),
	CONSTRAINT "message_events_bounce_type_check" CHECK ((type = 'bounced' and bounce_type in ('hard', 'soft')) or (type <> 'bounced' and bounce_type is null)),
	CONSTRAINT "message_events_provider_check" CHECK (provider ~ '^[a-z0-9_-]{1,32}$'),
	CONSTRAINT "message_events_provider_event_id_length" CHECK (length(provider_event_id) between 1 and 255),
	CONSTRAINT "message_events_detail_length" CHECK (detail is null or length(detail) <= 500)
);
--> statement-breakpoint
ALTER TABLE "notifications"."message_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."message_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging"."reports" DROP CONSTRAINT "reports_status_check";--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "messaging"."reports" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "messaging"."reports" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messaging"."reports" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "delivery" text;--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications"."message_events" ADD CONSTRAINT "message_events_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "notifications"."messages"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_suppressions_org_id_idx" ON "notifications"."address_suppressions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "address_suppressions_org_channel_address_key" ON "notifications"."address_suppressions" USING btree ("org_id","channel","address_norm");--> statement-breakpoint
CREATE INDEX "email_previews_org_id_idx" ON "notifications"."email_previews" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "email_previews_org_expires_idx" ON "notifications"."email_previews" USING btree ("org_id","expires_at");--> statement-breakpoint
CREATE INDEX "message_events_org_id_idx" ON "notifications"."message_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_events_org_provider_event_key" ON "notifications"."message_events" USING btree ("org_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "message_events_org_message_idx" ON "notifications"."message_events" USING btree ("org_id","message_id","occurred_at");--> statement-breakpoint
CREATE INDEX "reports_open_created_idx" ON "messaging"."reports" USING btree ("created_at","org_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "messages_org_event_queued_idx" ON "notifications"."messages" USING btree ("org_id","event_id","kind") WHERE status = 'queued' and event_id is not null;--> statement-breakpoint
CREATE INDEX "messages_org_provider_message_idx" ON "notifications"."messages" USING btree ("org_id","provider_message_id") WHERE provider_message_id is not null;--> statement-breakpoint
CREATE POLICY "address_suppressions_tenant_isolation" ON "notifications"."address_suppressions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "email_previews_tenant_isolation" ON "notifications"."email_previews" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "message_events_tenant_isolation" ON "notifications"."message_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M1.10d: CHECKs on existing tables added NOT VALID, then validated; any
-- report in the retired 'reviewed' state becomes 'resolved'; the delivery log is permanent)
UPDATE messaging.reports SET status = 'resolved', reviewed_at = updated_at, reviewed_by = 'system:migration', review_note = 'Reviewed before M1.10d' WHERE status = 'reviewed';--> statement-breakpoint
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_locale_check" CHECK (locale is null or locale in ('en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'ar', 'hi', 'ja', 'zh-CN', 'zh-TW')) NOT VALID;--> statement-breakpoint
ALTER TABLE "auth"."users" VALIDATE CONSTRAINT "users_locale_check";--> statement-breakpoint
ALTER TABLE "messaging"."reports" ADD CONSTRAINT "reports_review_check" CHECK ((status = 'open' and reviewed_at is null) or (status <> 'open' and reviewed_at is not null and reviewed_by is not null and review_note is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "messaging"."reports" VALIDATE CONSTRAINT "reports_review_check";--> statement-breakpoint
ALTER TABLE "messaging"."reports" ADD CONSTRAINT "reports_review_note_length" CHECK (review_note is null or length(review_note) between 1 and 1000) NOT VALID;--> statement-breakpoint
ALTER TABLE "messaging"."reports" VALIDATE CONSTRAINT "reports_review_note_length";--> statement-breakpoint
ALTER TABLE "messaging"."reports" ADD CONSTRAINT "reports_status_check" CHECK (status in ('open', 'resolved', 'dismissed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "messaging"."reports" VALIDATE CONSTRAINT "reports_status_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_delivery_check" CHECK (delivery is null or delivery in ('delivered', 'bounced', 'soft_bounced', 'complained')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_delivery_check";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "notifications"."message_events" FROM app_user;--> statement-breakpoint
-- hand-written: end
