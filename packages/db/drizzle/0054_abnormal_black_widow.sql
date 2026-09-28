CREATE TABLE "notifications"."auto_pauses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"complaints" integer NOT NULL,
	"sent" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" text,
	"lift_note" text,
	CONSTRAINT "auto_pauses_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "auto_pauses_counts_check" CHECK (complaints >= 0 and sent > 0 and rate_bps >= 0),
	CONSTRAINT "auto_pauses_lift_check" CHECK ((lifted_at is null and lifted_by is null and lift_note is null) or (lifted_at is not null and lifted_by is not null and length(lift_note) between 3 and 500))
);
--> statement-breakpoint
ALTER TABLE "notifications"."auto_pauses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."auto_pauses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."frequency_caps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" text NOT NULL,
	"max_messages" integer NOT NULL,
	"window_hours" integer NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "frequency_caps_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "frequency_caps_scope_check" CHECK (scope in ('reminders', 'event_updates', 'marketing', 'all')),
	CONSTRAINT "frequency_caps_max_check" CHECK (max_messages between 1 and 20),
	CONSTRAINT "frequency_caps_window_check" CHECK (window_hours between 1 and 720)
);
--> statement-breakpoint
ALTER TABLE "notifications"."frequency_caps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."frequency_caps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."quota_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"monthly_limit" integer NOT NULL,
	"reason" text NOT NULL,
	"set_by" text NOT NULL,
	CONSTRAINT "quota_limits_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "quota_limits_channel_check" CHECK (channel in ('email', 'sms', 'whatsapp', 'push')),
	CONSTRAINT "quota_limits_limit_check" CHECK (monthly_limit between 0 and 10000000),
	CONSTRAINT "quota_limits_reason_length" CHECK (length(reason) between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "notifications"."quota_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."quota_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period" text NOT NULL,
	"channel" text NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "usage_counters_period_check" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "usage_counters_channel_check" CHECK (channel in ('email', 'sms', 'whatsapp', 'push')),
	CONSTRAINT "usage_counters_counts_check" CHECK (messages >= 0 and units >= 0)
);
--> statement-breakpoint
ALTER TABLE "notifications"."usage_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."usage_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."consents" DROP CONSTRAINT "consents_channel_check";--> statement-breakpoint
ALTER TABLE "crm"."consents" DROP CONSTRAINT "consents_purpose_check";--> statement-breakpoint
ALTER TABLE "messaging"."announcements" DROP CONSTRAINT "announcements_channels_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" DROP CONSTRAINT "messages_channel_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" DROP CONSTRAINT "messages_address_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "recipient_region" text;--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "recipient_key" text;--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "segments" integer;--> statement-breakpoint
CREATE INDEX "auto_pauses_org_id_idx" ON "notifications"."auto_pauses" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "auto_pauses_org_created_idx" ON "notifications"."auto_pauses" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "frequency_caps_org_id_idx" ON "notifications"."frequency_caps" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "frequency_caps_org_scope_key" ON "notifications"."frequency_caps" USING btree ("org_id","scope");--> statement-breakpoint
CREATE INDEX "quota_limits_org_id_idx" ON "notifications"."quota_limits" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_limits_org_channel_key" ON "notifications"."quota_limits" USING btree ("org_id","channel");--> statement-breakpoint
CREATE INDEX "usage_counters_org_id_idx" ON "notifications"."usage_counters" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_org_period_channel_key" ON "notifications"."usage_counters" USING btree ("org_id","period","channel");--> statement-breakpoint
CREATE INDEX "messages_org_recipient_sent_idx" ON "notifications"."messages" USING btree ("org_id","recipient_key","sent_at") WHERE status = 'sent' and recipient_key is not null;--> statement-breakpoint
CREATE POLICY "auto_pauses_tenant_isolation" ON "notifications"."auto_pauses" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "frequency_caps_tenant_isolation" ON "notifications"."frequency_caps" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "quota_limits_tenant_isolation" ON "notifications"."quota_limits" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "usage_counters_tenant_isolation" ON "notifications"."usage_counters" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M3.5a: CHECKs on existing tables re-added NOT VALID, then validated:
-- WhatsApp as a channel and consent channel, informational consent, SMS announcements, message
-- region and segments)
ALTER TABLE "crm"."consents" ADD CONSTRAINT "consents_channel_check" CHECK (channel in ('email', 'sms', 'whatsapp')) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."consents" VALIDATE CONSTRAINT "consents_channel_check";--> statement-breakpoint
ALTER TABLE "crm"."consents" ADD CONSTRAINT "consents_purpose_check" CHECK (purpose in ('marketing', 'informational')) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."consents" VALIDATE CONSTRAINT "consents_purpose_check";--> statement-breakpoint
ALTER TABLE "messaging"."announcements" ADD CONSTRAINT "announcements_channels_check" CHECK (channels <@ array['email', 'push', 'sms']::text[] and cardinality(channels) > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "messaging"."announcements" VALIDATE CONSTRAINT "announcements_channels_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_recipient_region_check" CHECK (recipient_region is null or recipient_region ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_recipient_region_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_segments_check" CHECK (segments is null or segments between 0 and 100) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_segments_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_channel_check" CHECK (channel in ('email', 'sms', 'whatsapp', 'push')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_channel_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_address_check" CHECK ((channel = 'email' and (recipient_email is not null or recipient_user_id is not null)) or (channel = 'push' and recipient_user_id is not null) or channel in ('sms', 'whatsapp')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_address_check";--> statement-breakpoint
-- hand-written: end
