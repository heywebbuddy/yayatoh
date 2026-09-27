CREATE TABLE "platform"."rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "rate_limits_bucket_length" CHECK (length("platform"."rate_limits"."bucket") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "platform"."rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."rate_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."finder_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"email" text,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "finder_codes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "finder_codes_attempts_check" CHECK (attempts between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "seating"."finder_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."finder_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" ADD COLUMN "public_map" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" ADD COLUMN "finder_mode" text DEFAULT 'code' NOT NULL;--> statement-breakpoint
CREATE INDEX "rate_limits_org_id_idx" ON "platform"."rate_limits" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_org_bucket_window_key" ON "platform"."rate_limits" USING btree ("org_id","bucket","window_start");--> statement-breakpoint
CREATE INDEX "rate_limits_org_window_idx" ON "platform"."rate_limits" USING btree ("org_id","window_start");--> statement-breakpoint
CREATE INDEX "finder_codes_org_id_idx" ON "seating"."finder_codes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "finder_codes_org_event_email_idx" ON "seating"."finder_codes" USING btree ("org_id","event_id","email_hash","created_at");--> statement-breakpoint
CREATE INDEX "finder_codes_org_expires_idx" ON "seating"."finder_codes" USING btree ("org_id","expires_at");--> statement-breakpoint
-- Hand-edited: a CHECK on an existing table is added NOT VALID, then validated (no long lock).
ALTER TABLE "seating"."event_layouts" ADD CONSTRAINT "event_layouts_finder_mode_check" CHECK (finder_mode in ('code', 'name')) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" VALIDATE CONSTRAINT "event_layouts_finder_mode_check";--> statement-breakpoint
CREATE POLICY "rate_limits_tenant_isolation" ON "platform"."rate_limits" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "finder_codes_tenant_isolation" ON "seating"."finder_codes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));