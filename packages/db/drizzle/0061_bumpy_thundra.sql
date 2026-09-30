CREATE TABLE "notifications"."push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_id" uuid NOT NULL,
	"push_token_id" uuid,
	"platform" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"attempts" integer DEFAULT 1 NOT NULL,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "push_deliveries_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "push_deliveries_status_check" CHECK (status in ('sent', 'expired', 'rejected', 'retrying')),
	CONSTRAINT "push_deliveries_platform_check" CHECK (platform in ('fcm', 'apns', 'webpush')),
	CONSTRAINT "push_deliveries_http_status_check" CHECK (http_status is null or http_status between 100 and 599),
	CONSTRAINT "push_deliveries_provider_message_id_length" CHECK (provider_message_id is null or length(provider_message_id) <= 200)
);
--> statement-breakpoint
ALTER TABLE "notifications"."push_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."push_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."messages" DROP CONSTRAINT "messages_address_check";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD COLUMN "email_norm" text;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD COLUMN "p256dh" text;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD COLUMN "auth_secret" text;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "notifications"."push_deliveries" ADD CONSTRAINT "push_deliveries_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "notifications"."messages"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_deliveries_org_id_idx" ON "notifications"."push_deliveries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_deliveries_org_message_token_key" ON "notifications"."push_deliveries" USING btree ("org_id","message_id","push_token_id");--> statement-breakpoint
CREATE INDEX "push_deliveries_org_token_idx" ON "notifications"."push_deliveries" USING btree ("org_id","push_token_id") WHERE push_token_id is not null;--> statement-breakpoint
CREATE INDEX "push_tokens_org_email_idx" ON "notifications"."push_tokens" USING btree ("org_id","email_norm") WHERE email_norm is not null;--> statement-breakpoint
CREATE POLICY "push_deliveries_tenant_isolation" ON "notifications"."push_deliveries" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M1.10e: CHECKs on existing tables added NOT VALID, then validated; the push
-- delivery log keeps its rows when a device is removed: only the token column is cleared)
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_address_check" CHECK ((channel = 'email' and (recipient_email is not null or recipient_user_id is not null)) or (channel = 'push' and (recipient_user_id is not null or recipient_email is not null)) or channel = 'sms') NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_address_check";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_owner_check" CHECK ((user_id is not null) <> (email_norm is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_owner_check";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_email_norm_check" CHECK (email_norm is null or (email_norm = lower(btrim(email_norm)) and email_norm like '%@%')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_email_norm_check";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_webpush_check" CHECK ((platform = 'webpush' and token ~ '^https?://' and p256dh ~ '^[A-Za-z0-9_-]{87}$' and auth_secret ~ '^[A-Za-z0-9_-]{22}$') or (platform <> 'webpush' and p256dh is null and auth_secret is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_webpush_check";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_label_length" CHECK (label is null or length(label) between 1 and 80) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_label_length";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_time_zone_length" CHECK (time_zone is null or length(time_zone) between 1 and 64) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_time_zone_length";--> statement-breakpoint
ALTER TABLE "notifications"."push_deliveries" ADD CONSTRAINT "push_deliveries_token_fk" FOREIGN KEY ("org_id","push_token_id") REFERENCES "notifications"."push_tokens"("org_id","id") ON DELETE SET NULL ("push_token_id");
-- hand-written: end
