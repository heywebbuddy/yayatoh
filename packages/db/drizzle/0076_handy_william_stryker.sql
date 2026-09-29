CREATE TABLE "notifications"."channel_senders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"sender_ref" text,
	"display_number" text,
	"campaign_status" text,
	"last_checked_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	CONSTRAINT "channel_senders_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "channel_senders_channel_check" CHECK (channel in ('sms', 'whatsapp')),
	CONSTRAINT "channel_senders_provider_check" CHECK ((channel = 'sms' and provider = 'twilio' and sender_ref ~ '^MG[0-9a-f]{32}$' and campaign_status in ('not_registered', 'pending', 'verified', 'failed')) or (channel = 'whatsapp' and campaign_status is null and ((provider = 'whatsapp_cloud' and sender_ref ~ '^[0-9]{5,30}$') or (provider = 'whatsapp_gateway' and (sender_ref is null or sender_ref ~ '^[A-Za-z0-9_-]{1,64}$'))))),
	CONSTRAINT "channel_senders_display_number_check" CHECK (display_number is null or display_number ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "notifications"."channel_senders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."channel_senders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."inbound_keywords" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"keyword" text NOT NULL,
	"recipient_key" text NOT NULL,
	"contacts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbound_keywords_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "inbound_keywords_channel_check" CHECK (channel in ('sms', 'whatsapp')),
	CONSTRAINT "inbound_keywords_keyword_check" CHECK (keyword in ('stop', 'start', 'help')),
	CONSTRAINT "inbound_keywords_provider_check" CHECK (provider ~ '^[a-z0-9_-]{1,32}$'),
	CONSTRAINT "inbound_keywords_event_id_length" CHECK (length(provider_event_id) between 1 and 255),
	CONSTRAINT "inbound_keywords_contacts_check" CHECK (contacts >= 0)
);
--> statement-breakpoint
ALTER TABLE "notifications"."inbound_keywords" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."inbound_keywords" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."provider_health" (
	"provider" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"sends" integer DEFAULT 0 NOT NULL,
	"send_errors" integer DEFAULT 0 NOT NULL,
	"webhooks" integer DEFAULT 0 NOT NULL,
	"webhooks_rejected" integer DEFAULT 0 NOT NULL,
	"last_webhook_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "provider_health_provider_hour_pk" PRIMARY KEY("provider","hour"),
	CONSTRAINT "provider_health_provider_check" CHECK (provider ~ '^[a-z0-9_-]{1,32}$'),
	CONSTRAINT "provider_health_last_error_length" CHECK (last_error is null or length(last_error) <= 100)
);
--> statement-breakpoint
CREATE TABLE "notifications"."sending_domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dkim_status" text DEFAULT 'pending' NOT NULL,
	"spf_status" text DEFAULT 'pending' NOT NULL,
	"dmarc_status" text DEFAULT 'pending' NOT NULL,
	"dmarc_policy" text,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"created_by" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	CONSTRAINT "sending_domains_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sending_domains_status_check" CHECK (status in ('pending', 'verified', 'failed')),
	CONSTRAINT "sending_domains_dkim_check" CHECK (dkim_status in ('pending', 'verified', 'failed', 'missing')),
	CONSTRAINT "sending_domains_spf_check" CHECK (spf_status in ('pending', 'verified', 'failed', 'missing')),
	CONSTRAINT "sending_domains_dmarc_check" CHECK (dmarc_status in ('pending', 'verified', 'failed', 'missing')),
	CONSTRAINT "sending_domains_dmarc_policy_check" CHECK (dmarc_policy is null or dmarc_policy in ('none', 'quarantine', 'reject')),
	CONSTRAINT "sending_domains_provider_check" CHECK (provider in ('ses', 'fake')),
	CONSTRAINT "sending_domains_domain_check" CHECK (domain = lower(domain) and length(domain) between 4 and 253 and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
	CONSTRAINT "sending_domains_verified_check" CHECK ((status = 'verified') = (verified_at is not null and dkim_status = 'verified' and spf_status = 'verified')),
	CONSTRAINT "sending_domains_provider_ref_length" CHECK (provider_ref is null or length(provider_ref) <= 300)
);
--> statement-breakpoint
ALTER TABLE "notifications"."sending_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."sending_domains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" DROP CONSTRAINT "address_suppressions_channel_check";--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" DROP CONSTRAINT "address_suppressions_reason_check";--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" DROP CONSTRAINT "address_suppressions_address_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "fallback_of" uuid;--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD COLUMN "fallback_reason" text;--> statement-breakpoint
CREATE INDEX "channel_senders_org_id_idx" ON "notifications"."channel_senders" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_senders_org_channel_key" ON "notifications"."channel_senders" USING btree ("org_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_senders_provider_ref_key" ON "notifications"."channel_senders" USING btree ("provider","sender_ref") WHERE sender_ref is not null;--> statement-breakpoint
CREATE INDEX "inbound_keywords_org_id_idx" ON "notifications"."inbound_keywords" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_keywords_org_provider_event_key" ON "notifications"."inbound_keywords" USING btree ("org_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "inbound_keywords_org_recipient_idx" ON "notifications"."inbound_keywords" USING btree ("org_id","recipient_key","received_at");--> statement-breakpoint
CREATE INDEX "sending_domains_org_id_idx" ON "notifications"."sending_domains" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domains_org_key" ON "notifications"."sending_domains" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domains_domain_key" ON "notifications"."sending_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "messages_org_fallback_idx" ON "notifications"."messages" USING btree ("org_id","fallback_of") WHERE fallback_of is not null;--> statement-breakpoint
CREATE INDEX "messages_recipient_key_texts_idx" ON "notifications"."messages" USING btree ("recipient_key","org_id") WHERE channel in ('sms', 'whatsapp') and recipient_key is not null;--> statement-breakpoint
CREATE POLICY "channel_senders_tenant_isolation" ON "notifications"."channel_senders" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "inbound_keywords_tenant_isolation" ON "notifications"."inbound_keywords" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sending_domains_tenant_isolation" ON "notifications"."sending_domains" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M3.5b)
-- 1. CHECKs and the self-FK on existing tables added NOT VALID, then validated (drizzle-kit
--    generated the matching DROP CONSTRAINTs above).
ALTER TABLE "notifications"."address_suppressions" ADD CONSTRAINT "address_suppressions_channel_check" CHECK (channel in ('email', 'sms', 'whatsapp')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" VALIDATE CONSTRAINT "address_suppressions_channel_check";--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" ADD CONSTRAINT "address_suppressions_reason_check" CHECK (reason in ('hard_bounce', 'soft_bounce', 'complaint', 'opt_out')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" VALIDATE CONSTRAINT "address_suppressions_reason_check";--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" ADD CONSTRAINT "address_suppressions_address_check" CHECK ((channel = 'email' and address_norm = lower(btrim(address_norm)) and address_norm like '%@%') or (channel in ('sms', 'whatsapp') and address_norm ~ '^\+[0-9]{6,15}$')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."address_suppressions" VALIDATE CONSTRAINT "address_suppressions_address_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_provider_check" CHECK (provider is null or provider in ('ses', 'twilio', 'whatsapp_cloud', 'whatsapp_gateway', 'fake', 'dev', 'memory', 'webpush')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_provider_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_fallback_check" CHECK ((fallback_of is null and fallback_reason is null) or (fallback_of is not null and fallback_reason in ('no_address', 'not_on_whatsapp', 'invalid_number', 'provider_error', 'undelivered', 'consent_missing', 'whatsapp_marketing_us', 'no_device', 'bounced'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_fallback_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_fallback_fk" FOREIGN KEY ("org_id","fallback_of") REFERENCES "notifications"."messages"("org_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_fallback_fk";--> statement-breakpoint
-- 2. Provider health is a platform table: no app_user privileges (only the function below);
--    staff read it through platform_reader.
REVOKE ALL ON notifications.provider_health FROM app_user;--> statement-breakpoint
REVOKE ALL ON notifications.provider_health FROM platform_reader;--> statement-breakpoint
GRANT SELECT ON notifications.provider_health TO platform_reader;--> statement-breakpoint
-- One count per send, send error, verified or refused webhook, in the current UTC hour.
CREATE FUNCTION notifications.record_provider_health(p_provider text, p_kind text, p_error text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO notifications.provider_health AS h
    (provider, hour, sends, send_errors, webhooks, webhooks_rejected, last_webhook_at, last_error_at, last_error)
  VALUES (
    left(p_provider, 32),
    date_trunc('hour', now()),
    (p_kind = 'send')::int,
    (p_kind = 'send_error')::int,
    (p_kind = 'webhook')::int,
    (p_kind = 'webhook_rejected')::int,
    CASE WHEN p_kind = 'webhook' THEN now() END,
    CASE WHEN p_kind IN ('send_error', 'webhook_rejected') THEN now() END,
    CASE WHEN p_kind IN ('send_error', 'webhook_rejected') THEN left(p_error, 100) END
  )
  ON CONFLICT (provider, hour) DO UPDATE SET
    sends = h.sends + (p_kind = 'send')::int,
    send_errors = h.send_errors + (p_kind = 'send_error')::int,
    webhooks = h.webhooks + (p_kind = 'webhook')::int,
    webhooks_rejected = h.webhooks_rejected + (p_kind = 'webhook_rejected')::int,
    last_webhook_at = CASE WHEN p_kind = 'webhook' THEN now() ELSE h.last_webhook_at END,
    last_error_at = CASE WHEN p_kind IN ('send_error', 'webhook_rejected') THEN now() ELSE h.last_error_at END,
    last_error = CASE WHEN p_kind IN ('send_error', 'webhook_rejected') THEN left(p_error, 100) ELSE h.last_error END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.record_provider_health(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.record_provider_health(text, text, text) TO app_user;--> statement-breakpoint
-- 3. Inbound STOP/START/HELP: which orgs a keyword applies to. The org whose dedicated sender it
--    reached; else (the shared senders) every org without its own number on that channel that
--    texted this number (by the keyed hash, never the number). Org ids only.
CREATE FUNCTION notifications.inbound_orgs(p_channel text, p_provider text, p_sender_ref text, p_recipient_key text)
RETURNS TABLE (org_id uuid, dedicated boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH own AS (
    SELECT s.org_id FROM notifications.channel_senders s
    WHERE s.channel = p_channel AND s.provider = p_provider AND s.sender_ref = p_sender_ref
  )
  SELECT own.org_id, true FROM own
  UNION ALL
  SELECT DISTINCT m.org_id, false FROM notifications.messages m
  WHERE NOT EXISTS (SELECT 1 FROM own)
    AND m.recipient_key = p_recipient_key
    AND m.channel = p_channel
    AND m.status = 'sent'
    AND NOT EXISTS (
      SELECT 1 FROM notifications.channel_senders s2
      WHERE s2.org_id = m.org_id AND s2.channel = p_channel AND s2.sender_ref IS NOT NULL
    )
  LIMIT 500
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.inbound_orgs(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.inbound_orgs(text, text, text, text) TO app_user;
-- hand-written: end
