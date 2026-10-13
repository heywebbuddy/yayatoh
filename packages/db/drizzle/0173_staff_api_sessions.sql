-- M7.2e: native staff push on the device-bound subscription row, and bearer (app) portal sessions.
-- hand-written: begin
-- New checks on existing tables are added NOT VALID, then validated (no long lock).
-- hand-written: end
ALTER TABLE "checkin"."staff_push_subscriptions" DROP CONSTRAINT "staff_push_subscriptions_p256dh_check";--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" DROP CONSTRAINT "staff_push_subscriptions_auth_check";--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" DROP CONSTRAINT "staff_push_subscriptions_endpoint_check";--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ALTER COLUMN "p256dh" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ALTER COLUMN "auth_secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ADD COLUMN "platform" text DEFAULT 'webpush' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" ADD COLUMN "kind" text DEFAULT 'cookie' NOT NULL;--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" ADD COLUMN "refresh_hash" text;--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" ADD COLUMN "previous_refresh_hash" text;--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" ADD COLUMN "refresh_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_org_refresh_key" ON "events"."portal_sessions" USING btree ("org_id","refresh_hash") WHERE refresh_hash is not null;--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_platform_check" CHECK (platform in ('webpush', 'apns', 'fcm')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_keys_check" CHECK ((platform = 'webpush' and p256dh ~ '^[A-Za-z0-9_-]{87}$' and auth_secret ~ '^[A-Za-z0-9_-]{22}$' and app_id is null) or (platform <> 'webpush' and p256dh is null and auth_secret is null and (app_id is null or length(app_id) between 3 and 200))) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_endpoint_check" CHECK ((platform = 'webpush' and endpoint ~ '^https?://' and length(endpoint) <= 2048) or (platform <> 'webpush' and length(endpoint) between 8 and 4096)) NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" ADD CONSTRAINT "portal_sessions_kind_check" CHECK (kind in ('cookie', 'bearer')) NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" ADD CONSTRAINT "portal_sessions_bearer_check" CHECK ((kind = 'cookie' and refresh_hash is null and previous_refresh_hash is null and refresh_expires_at is null) or (kind = 'bearer' and refresh_hash is not null and refresh_expires_at is not null)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" VALIDATE CONSTRAINT "staff_push_subscriptions_platform_check";
--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" VALIDATE CONSTRAINT "staff_push_subscriptions_keys_check";
--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" VALIDATE CONSTRAINT "staff_push_subscriptions_endpoint_check";
--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" VALIDATE CONSTRAINT "portal_sessions_kind_check";
--> statement-breakpoint
ALTER TABLE "events"."portal_sessions" VALIDATE CONSTRAINT "portal_sessions_bearer_check";
