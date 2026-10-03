CREATE TABLE "integrations"."audience_syncs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"segment_id" uuid,
	"list_id" text NOT NULL,
	"list_name" text NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "audience_syncs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "audience_syncs_list_id_check" CHECK (list_id ~ '^[A-Za-z0-9_-]{1,100}$'),
	CONSTRAINT "audience_syncs_list_name_check" CHECK (length(list_name) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "integrations"."audience_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."audience_syncs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."consent_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"change" text NOT NULL,
	"external_id" text NOT NULL,
	"remote_version" text NOT NULL,
	"consent_withdrawn" boolean NOT NULL,
	"suppressed" boolean NOT NULL,
	CONSTRAINT "consent_changes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "consent_changes_change_check" CHECK (change in ('unsubscribed', 'cleaned', 'complained')),
	CONSTRAINT "consent_changes_external_check" CHECK (length(external_id) between 1 and 255),
	CONSTRAINT "consent_changes_version_check" CHECK (length(remote_version) between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "integrations"."consent_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."consent_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."suppressions" DROP CONSTRAINT "suppressions_source_check";--> statement-breakpoint
ALTER TABLE "integrations"."audience_syncs" ADD CONSTRAINT "audience_syncs_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."consent_changes" ADD CONSTRAINT "consent_changes_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audience_syncs_org_id_idx" ON "integrations"."audience_syncs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_syncs_org_connection_key" ON "integrations"."audience_syncs" USING btree ("org_id","connection_id");--> statement-breakpoint
CREATE INDEX "consent_changes_org_id_idx" ON "integrations"."consent_changes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_changes_org_connection_record_key" ON "integrations"."consent_changes" USING btree ("org_id","connection_id","external_id","remote_version");--> statement-breakpoint
CREATE INDEX "consent_changes_org_connection_created_idx" ON "integrations"."consent_changes" USING btree ("org_id","connection_id","created_at");--> statement-breakpoint
CREATE INDEX "consent_changes_org_contact_idx" ON "integrations"."consent_changes" USING btree ("org_id","contact_id");--> statement-breakpoint
ALTER TABLE "notifications"."suppressions" ADD CONSTRAINT "suppressions_source_check" CHECK (source in ('one_click', 'page', 'legacy', 'block', 'mailchimp', 'klaviyo', 'hubspot')) NOT VALID;--> statement-breakpoint
-- hand-written: begin (M6.4d) — the widened check is added NOT VALID, then validated.
ALTER TABLE "notifications"."suppressions" VALIDATE CONSTRAINT "suppressions_source_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "audience_syncs_tenant_isolation" ON "integrations"."audience_syncs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "consent_changes_tenant_isolation" ON "integrations"."consent_changes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M6.4d) — consent changes reference the crm contact (composite, same org).
ALTER TABLE "integrations"."consent_changes" ADD CONSTRAINT "consent_changes_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;
-- hand-written: end
