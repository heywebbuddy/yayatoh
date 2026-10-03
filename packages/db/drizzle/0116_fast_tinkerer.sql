CREATE TABLE "tenancy"."api_key_usage_daily" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"day" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"rate_limited" integer DEFAULT 0 NOT NULL,
	"audited_at" timestamp with time zone,
	CONSTRAINT "api_key_usage_daily_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "api_key_usage_daily_counts_check" CHECK (requests >= 0 and errors between 0 and requests and rate_limited between 0 and errors)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."api_key_usage_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."api_key_usage_daily" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."sandbox_orgs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sandbox_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "sandbox_orgs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sandbox_orgs_name_length" CHECK (length(name) between 1 and 60),
	CONSTRAINT "sandbox_orgs_not_self" CHECK (sandbox_org_id <> org_id)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."sandbox_orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."sandbox_orgs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."plans" ADD COLUMN "quotas" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD COLUMN "replaced_by_id" uuid;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD COLUMN "sandbox_parent_org_id" uuid;--> statement-breakpoint
ALTER TABLE "tenancy"."api_key_usage_daily" ADD CONSTRAINT "api_key_usage_daily_key_fk" FOREIGN KEY ("org_id","api_key_id") REFERENCES "tenancy"."api_keys"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."sandbox_orgs" ADD CONSTRAINT "sandbox_orgs_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_usage_daily_org_id_idx" ON "tenancy"."api_key_usage_daily" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_usage_daily_org_key_day_key" ON "tenancy"."api_key_usage_daily" USING btree ("org_id","api_key_id","day");--> statement-breakpoint
CREATE INDEX "api_key_usage_daily_org_day_idx" ON "tenancy"."api_key_usage_daily" USING btree ("org_id","day");--> statement-breakpoint
CREATE INDEX "sandbox_orgs_org_id_idx" ON "tenancy"."sandbox_orgs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_orgs_sandbox_org_key" ON "tenancy"."sandbox_orgs" USING btree ("sandbox_org_id");--> statement-breakpoint
CREATE INDEX "sandbox_orgs_org_created_idx" ON "tenancy"."sandbox_orgs" USING btree ("org_id","created_at");--> statement-breakpoint
-- hand-written: begin (CHECK on an existing table: NOT VALID, then validated)
ALTER TABLE "billing"."plans" ADD CONSTRAINT "plans_quotas_check" CHECK (jsonb_typeof(quotas) = 'object') NOT VALID;--> statement-breakpoint
ALTER TABLE "billing"."plans" VALIDATE CONSTRAINT "plans_quotas_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (CHECK on an existing table: NOT VALID, then validated)
ALTER TABLE "tenancy"."organizations" ADD CONSTRAINT "organizations_sandbox_parent_check" CHECK (sandbox = (sandbox_parent_org_id is not null) and (sandbox_parent_org_id is null or sandbox_parent_org_id <> id)) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" VALIDATE CONSTRAINT "organizations_sandbox_parent_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "api_key_usage_daily_tenant_isolation" ON "tenancy"."api_key_usage_daily" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sandbox_orgs_tenant_isolation" ON "tenancy"."sandbox_orgs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.3a: an API key resolves only while it is live (not revoked, not past expires_at). The result
-- gains the key's expiry and whether its org is a sandbox (the rate limit and the banner use it).
DROP FUNCTION tenancy.api_key_by_hash(text);
--> statement-breakpoint
CREATE FUNCTION tenancy.api_key_by_hash(p_key_hash text)
RETURNS TABLE (org_id uuid, key_id uuid, scopes text[], expires_at timestamptz, org_sandbox boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT k.org_id, k.id, k.scopes, k.expires_at, o.sandbox
  FROM tenancy.api_keys k
  JOIN tenancy.organizations o ON o.id = k.org_id AND o.status IN ('active', 'limited')
  WHERE k.key_hash = p_key_hash AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.api_key_by_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.api_key_by_hash(text) TO app_user;
--> statement-breakpoint
-- M6.3a: the parent org of a sandbox being provisioned (or null), read from the parent's link row
-- before any parent tenant is set. Returns one uuid only; a deleted link resolves to nothing.
CREATE FUNCTION tenancy.sandbox_parent_of(p_sandbox_org_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.org_id FROM tenancy.sandbox_orgs s
  WHERE s.sandbox_org_id = p_sandbox_org_id AND s.deleted_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.sandbox_parent_of(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.sandbox_parent_of(uuid) TO app_user;
--> statement-breakpoint
-- M6.3a (P6-13): every plan gets the api_access module key (free within quotas in beta), with
-- placeholder quotas the owner replaces when plans are priced (D22).
INSERT INTO billing.plan_modules (plan_key, module_key)
SELECT key, 'api_access' FROM billing.plans
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE billing.plans
SET quotas = quotas || jsonb_build_object('api_access', jsonb_build_object(
  'requestsPerMinute', 600,
  'orgRequestsPerMinute', 1200,
  'testKeyRequestsPerMinute', 120,
  'sandboxRequestsPerMinute', 300
));
-- hand-written: end
