CREATE SCHEMA "webhooks";
--> statement-breakpoint
CREATE TABLE "webhooks"."endpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_endpoint_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"event_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	CONSTRAINT "endpoints_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "endpoints_status_check" CHECK (status in ('active', 'disabled')),
	CONSTRAINT "endpoints_url_check" CHECK (url ~ '^https://' and length(url) <= 2048),
	CONSTRAINT "endpoints_description_check" CHECK (length(description) <= 200)
);
--> statement-breakpoint
ALTER TABLE "webhooks"."endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhooks"."endpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "endpoints_org_id_idx" ON "webhooks"."endpoints" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "endpoints_org_provider_key" ON "webhooks"."endpoints" USING btree ("org_id","provider_endpoint_id");--> statement-breakpoint
CREATE INDEX "endpoints_org_status_idx" ON "webhooks"."endpoints" USING btree ("org_id","status");--> statement-breakpoint
CREATE POLICY "endpoints_tenant_isolation" ON "webhooks"."endpoints" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));