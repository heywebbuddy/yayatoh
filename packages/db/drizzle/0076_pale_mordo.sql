CREATE TABLE "checkin"."staff_alert_pushes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"alert_key" text NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"http_status" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "staff_alert_pushes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "staff_alert_pushes_kind_check" CHECK (kind in ('device_offline', 'device_low_battery', 'device_backlog', 'capacity_near')),
	CONSTRAINT "staff_alert_pushes_status_check" CHECK (status in ('queued', 'sent', 'expired', 'rejected', 'retrying')),
	CONSTRAINT "staff_alert_pushes_key_check" CHECK (length(alert_key) between 3 and 200)
);
--> statement-breakpoint
ALTER TABLE "checkin"."staff_alert_pushes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."staff_alert_pushes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "checkin"."staff_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth_secret" text NOT NULL,
	"locale" text NOT NULL,
	"copy" jsonb NOT NULL,
	"supervisor_user_id" uuid,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "staff_push_subscriptions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "staff_push_subscriptions_endpoint_check" CHECK (endpoint ~ '^https?://' and length(endpoint) <= 2048),
	CONSTRAINT "staff_push_subscriptions_p256dh_check" CHECK (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
	CONSTRAINT "staff_push_subscriptions_auth_check" CHECK (auth_secret ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "staff_push_subscriptions_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "checkpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "sync_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "checkpoint_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "requested_checkpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "mode" text DEFAULT 'scanner' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "kiosk_event_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "kiosk_checkpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "kiosk_pin_hash" text;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "kiosk_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "kiosk_started_by" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."staff_alert_pushes" ADD CONSTRAINT "staff_alert_pushes_subscription_fk" FOREIGN KEY ("org_id","subscription_id") REFERENCES "checkin"."staff_push_subscriptions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin"."staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_alert_pushes_org_id_idx" ON "checkin"."staff_alert_pushes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_alert_pushes_org_sub_key" ON "checkin"."staff_alert_pushes" USING btree ("org_id","subscription_id","alert_key");--> statement-breakpoint
CREATE INDEX "staff_alert_pushes_org_status_idx" ON "checkin"."staff_alert_pushes" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "staff_push_subscriptions_org_id_idx" ON "checkin"."staff_push_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_push_subscriptions_org_device_key" ON "checkin"."staff_push_subscriptions" USING btree ("org_id","device_id");--> statement-breakpoint
CREATE INDEX "devices_org_event_idx" ON "checkin"."devices" USING btree ("org_id","event_id");--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_mode_check" CHECK (mode in ('scanner', 'kiosk')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_kiosk_check" CHECK ((mode = 'kiosk') = (kiosk_event_id is not null and kiosk_pin_hash is not null and kiosk_started_at is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_kiosk_pin_check" CHECK (kiosk_pin_hash is null or kiosk_pin_hash ~ '^pbkdf2-sha256[$][0-9]{4,7}[$][A-Za-z0-9_-]{22}[$][A-Za-z0-9_-]{43}$') NOT VALID;--> statement-breakpoint
CREATE POLICY "staff_alert_pushes_tenant_isolation" ON "checkin"."staff_alert_pushes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "staff_push_subscriptions_tenant_isolation" ON "checkin"."staff_push_subscriptions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin
-- The new checks on the existing devices table were added NOT VALID (no long lock); validate now.
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_mode_check";--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_kiosk_check";--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_kiosk_pin_check";--> statement-breakpoint
-- Composite FKs down to events (another module's table: hand-written, like M1.9's).
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_event_fk";--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_kiosk_event_fk" FOREIGN KEY ("org_id","kiosk_event_id") REFERENCES "events"."events"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_kiosk_event_fk";--> statement-breakpoint
ALTER TABLE "checkin"."staff_alert_pushes" ADD CONSTRAINT "staff_alert_pushes_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
-- Checkpoints are archived, never deleted.
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_checkpoint_fk" FOREIGN KEY ("org_id","checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_checkpoint_fk";--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_requested_checkpoint_fk" FOREIGN KEY ("org_id","requested_checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_requested_checkpoint_fk";--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_kiosk_checkpoint_fk" FOREIGN KEY ("org_id","kiosk_checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_kiosk_checkpoint_fk";
-- hand-written: end
