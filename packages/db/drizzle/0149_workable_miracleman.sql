CREATE TABLE "integrations"."slack_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_ts" text,
	"error_code" text,
	"requested_by" uuid,
	CONSTRAINT "slack_messages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "slack_messages_channel_check" CHECK (channel_id ~ '^[CGD][A-Z0-9]{2,20}$'),
	CONSTRAINT "slack_messages_kind_check" CHECK (kind in ('alert', 'digest', 'test')),
	CONSTRAINT "slack_messages_status_check" CHECK (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "slack_messages_dedupe_check" CHECK (dedupe_key ~ '^[a-z]+:[A-Za-z0-9:_-]{1,120}$'),
	CONSTRAINT "slack_messages_payload_check" CHECK (jsonb_typeof(payload) = 'object'),
	CONSTRAINT "slack_messages_attempts_check" CHECK (attempts between 0 and 100),
	CONSTRAINT "slack_messages_sent_check" CHECK ((status = 'sent') = (sent_at is not null)),
	CONSTRAINT "slack_messages_ts_check" CHECK (provider_ts is null or length(provider_ts) <= 40),
	CONSTRAINT "slack_messages_error_check" CHECK (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$')
);
--> statement-breakpoint
ALTER TABLE "integrations"."slack_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."slack_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."slack_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"channel_id" text,
	"channel_name" text,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"alert_min_severity" text DEFAULT 'warning' NOT NULL,
	"digest_enabled" boolean DEFAULT false NOT NULL,
	"digest_time" text DEFAULT '08:00' NOT NULL,
	"digest_next_at" timestamp with time zone,
	"include_finance" boolean DEFAULT false NOT NULL,
	"finance_opted_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "slack_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "slack_settings_channel_check" CHECK (channel_id is null or channel_id ~ '^[CGD][A-Z0-9]{2,20}$'),
	CONSTRAINT "slack_settings_channel_name_check" CHECK (channel_name is null or length(channel_name) between 1 and 80),
	CONSTRAINT "slack_settings_severity_check" CHECK (alert_min_severity in ('info', 'warning', 'critical')),
	CONSTRAINT "slack_settings_time_check" CHECK (digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "slack_settings_finance_check" CHECK (not include_finance or finance_opted_by is not null),
	CONSTRAINT "slack_settings_digest_check" CHECK (not digest_enabled or channel_id is not null)
);
--> statement-breakpoint
ALTER TABLE "integrations"."slack_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."slack_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" DROP CONSTRAINT "api_keys_scopes_check";--> statement-breakpoint
ALTER TABLE "webhooks"."endpoints" ADD COLUMN "source" text DEFAULT 'console' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks"."endpoints" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations"."slack_messages" ADD CONSTRAINT "slack_messages_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."slack_settings" ADD CONSTRAINT "slack_settings_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_messages_org_id_idx" ON "integrations"."slack_messages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_messages_org_dedupe_key" ON "integrations"."slack_messages" USING btree ("org_id","connection_id","channel_id","kind","dedupe_key");--> statement-breakpoint
CREATE INDEX "slack_messages_org_connection_created_idx" ON "integrations"."slack_messages" USING btree ("org_id","connection_id","created_at");--> statement-breakpoint
CREATE INDEX "slack_messages_due_idx" ON "integrations"."slack_messages" USING btree ("next_attempt_at","org_id") WHERE status in ('pending', 'sending', 'failed');--> statement-breakpoint
CREATE INDEX "slack_settings_org_id_idx" ON "integrations"."slack_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_settings_org_connection_key" ON "integrations"."slack_settings" USING btree ("org_id","connection_id");--> statement-breakpoint
CREATE INDEX "slack_settings_digest_due_idx" ON "integrations"."slack_settings" USING btree ("digest_next_at","org_id") WHERE digest_enabled;--> statement-breakpoint
-- hand-edited (M6.4c): CHECKs on existing tables are added NOT VALID, then validated.
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_scopes_check" CHECK (cardinality(scopes) >= 1 and scopes <@ array['org:read', 'events:read', 'events:write', 'orders:read', 'orders:refund', 'attendees:read', 'attendees:write', 'checkin:scan', 'contacts:write', 'webhooks:subscribe']::text[]) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" VALIDATE CONSTRAINT "api_keys_scopes_check";--> statement-breakpoint
ALTER TABLE "webhooks"."endpoints" ADD CONSTRAINT "endpoints_source_check" CHECK (source in ('console', 'rest_hook')) NOT VALID;--> statement-breakpoint
ALTER TABLE "webhooks"."endpoints" VALIDATE CONSTRAINT "endpoints_source_check";--> statement-breakpoint
CREATE POLICY "slack_messages_tenant_isolation" ON "integrations"."slack_messages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "slack_settings_tenant_isolation" ON "integrations"."slack_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));;--> statement-breakpoint
-- hand-written: begin (M6.4c Slack)
-- The Slack sender (worker leader, platform_reader): orgs with Slack work now — a message that is
-- due (new, a retry, or a dead sender's lease ran out) or a digest whose time has come. Ids only.
CREATE FUNCTION integrations.orgs_with_slack_work(p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT w.org_id FROM (
    SELECT m.org_id, coalesce(m.next_attempt_at, m.lease_until) AS due FROM integrations.slack_messages m
    WHERE (m.status IN ('pending', 'failed') AND m.next_attempt_at <= now())
       OR (m.status = 'sending' AND m.lease_until <= now())
    UNION ALL
    SELECT s.org_id, s.digest_next_at FROM integrations.slack_settings s
    WHERE s.digest_enabled AND s.digest_next_at <= now()
  ) w
  GROUP BY w.org_id
  -- Longest-waiting first, so no org waits behind a busy one.
  ORDER BY min(w.due)
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION integrations.orgs_with_slack_work(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integrations.orgs_with_slack_work(integer) TO platform_reader;
-- hand-written: end
