CREATE SCHEMA "campaigns";
--> statement-breakpoint
CREATE TABLE "campaigns"."campaign_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"link_id" uuid NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "campaign_links_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "campaign_links_block_check" CHECK (block_id ~ '^[a-z0-9]{1,16}$'),
	CONSTRAINT "campaign_links_code_check" CHECK (code ~ '^[a-z0-9]{8}$')
);
--> statement-breakpoint
ALTER TABLE "campaigns"."campaign_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns"."campaign_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaigns"."campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"released_at" timestamp with time zone,
	CONSTRAINT "campaign_recipients_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "campaign_recipients_status_check" CHECK (status in ('pending', 'queued', 'excluded', 'cancelled')),
	CONSTRAINT "campaign_recipients_reason_check" CHECK ((status = 'excluded') = (reason is not null) and (reason is null or reason in ('no_address', 'erased', 'suppressed', 'unsubscribed', 'consent_withdrawn', 'consent_missing'))),
	CONSTRAINT "campaign_recipients_released_check" CHECK ((status = 'queued') = (released_at is not null))
);
--> statement-breakpoint
ALTER TABLE "campaigns"."campaign_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns"."campaign_recipients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaigns"."campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"content" jsonb NOT NULL,
	"audience_kind" text,
	"segment_id" uuid,
	"template_key" text,
	"template_event_id" uuid,
	"template_ticket_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"failure_reason" text,
	"rate_per_minute" integer,
	"content_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "campaigns_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "campaigns_name_check" CHECK (length(btrim(name)) between 1 and 120),
	CONSTRAINT "campaigns_channel_check" CHECK (channel in ('email', 'sms', 'whatsapp')),
	CONSTRAINT "campaigns_status_check" CHECK (status in ('draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled')),
	CONSTRAINT "campaigns_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "campaigns_content_check" CHECK (jsonb_typeof(content) = 'object'),
	CONSTRAINT "campaigns_audience_kind_check" CHECK (audience_kind is null or audience_kind in ('segment', 'template')),
	CONSTRAINT "campaigns_audience_check" CHECK ((audience_kind is null) or (audience_kind = 'segment' and segment_id is not null) or (audience_kind = 'template' and template_key is not null and template_event_id is not null)),
	CONSTRAINT "campaigns_scheduled_check" CHECK (status <> 'scheduled' or scheduled_at is not null),
	CONSTRAINT "campaigns_rate_check" CHECK (rate_per_minute is null or rate_per_minute between 1 and 100000),
	CONSTRAINT "campaigns_failure_reason_check" CHECK (failure_reason is null or length(failure_reason) <= 64)
);
--> statement-breakpoint
ALTER TABLE "campaigns"."campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns"."campaigns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."stored_contents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject" text NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"html" text NOT NULL,
	"text_body" text NOT NULL,
	"sms_body" text,
	"locale" text DEFAULT 'en' NOT NULL,
	CONSTRAINT "stored_contents_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "stored_contents_subject_check" CHECK (length(subject) between 1 and 300),
	CONSTRAINT "stored_contents_html_check" CHECK (length(html) <= 500000),
	CONSTRAINT "stored_contents_sms_check" CHECK (sms_body is null or length(sms_body) <= 2000)
);
--> statement-breakpoint
ALTER TABLE "notifications"."stored_contents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."stored_contents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns"."campaign_links" ADD CONSTRAINT "campaign_links_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "campaigns"."campaigns"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns"."campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "campaigns"."campaigns"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_links_org_id_idx" ON "campaigns"."campaign_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_links_org_campaign_block_key" ON "campaigns"."campaign_links" USING btree ("org_id","campaign_id","block_id");--> statement-breakpoint
CREATE INDEX "campaign_links_org_link_idx" ON "campaigns"."campaign_links" USING btree ("org_id","link_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_org_id_idx" ON "campaigns"."campaign_recipients" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_org_campaign_contact_key" ON "campaigns"."campaign_recipients" USING btree ("org_id","campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_org_campaign_status_idx" ON "campaigns"."campaign_recipients" USING btree ("org_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_org_contact_idx" ON "campaigns"."campaign_recipients" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_org_released_idx" ON "campaigns"."campaign_recipients" USING btree ("org_id","released_at") WHERE released_at is not null;--> statement-breakpoint
CREATE INDEX "campaigns_org_id_idx" ON "campaigns"."campaigns" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_name_key" ON "campaigns"."campaigns" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns"."campaigns" USING btree ("org_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "campaigns_due_idx" ON "campaigns"."campaigns" USING btree ("scheduled_at","org_id") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "campaigns_sending_idx" ON "campaigns"."campaigns" USING btree ("org_id") WHERE status = 'sending';--> statement-breakpoint
CREATE INDEX "stored_contents_org_id_idx" ON "notifications"."stored_contents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "stored_contents_org_created_idx" ON "notifications"."stored_contents" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "campaign_links_tenant_isolation" ON "campaigns"."campaign_links" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "campaign_recipients_tenant_isolation" ON "campaigns"."campaign_recipients" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "campaigns_tenant_isolation" ON "campaigns"."campaigns" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "stored_contents_tenant_isolation" ON "notifications"."stored_contents" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module composite foreign keys (M3.6b). The tables are new and empty, so they are added valid.
-- A contact removed from crm (erasure) takes its snapshot rows with it.
ALTER TABLE "campaigns"."campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- Each button/event card's tracked link (M3.8a).
ALTER TABLE "campaigns"."campaign_links" ADD CONSTRAINT "campaign_links_link_fk" FOREIGN KEY ("org_id","link_id") REFERENCES "marketing"."tracking_links"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The stored email a send uses (notifications); only the reference is cleared if it goes.
ALTER TABLE "campaigns"."campaigns" ADD CONSTRAINT "campaigns_content_fk" FOREIGN KEY ("org_id","content_id") REFERENCES "notifications"."stored_contents"("org_id","id") ON DELETE SET NULL ("content_id");
-- hand-written: end
