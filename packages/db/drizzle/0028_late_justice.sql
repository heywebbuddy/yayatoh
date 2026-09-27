CREATE TABLE "tenancy"."org_domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hostname" text NOT NULL,
	"kind" text DEFAULT 'site' NOT NULL,
	"managed" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending_dns' NOT NULL,
	"provider_ref" text,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ssl_status" text,
	"payment_method_domain_id" text,
	"failure_reason" text,
	"last_checked_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	CONSTRAINT "org_domains_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_domains_kind_check" CHECK (kind in ('site')),
	CONSTRAINT "org_domains_status_check" CHECK (status in ('pending_dns', 'verifying', 'active', 'failed')),
	CONSTRAINT "org_domains_primary_active_check" CHECK (not is_primary or status = 'active'),
	CONSTRAINT "org_domains_hostname_check" CHECK (hostname = lower(hostname) and length(hostname) between 4 and 253 and hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);
--> statement-breakpoint
ALTER TABLE "tenancy"."org_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."org_domains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."org_domains" ADD CONSTRAINT "org_domains_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_domains_org_id_idx" ON "tenancy"."org_domains" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_domains_hostname_key" ON "tenancy"."org_domains" USING btree ("hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "org_domains_org_primary_key" ON "tenancy"."org_domains" USING btree ("org_id","kind") WHERE is_primary;--> statement-breakpoint
CREATE POLICY "org_domains_tenant_isolation" ON "tenancy"."org_domains" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- Host routing (M1.11): the org serving an active site hostname and its primary host, nothing
-- else. Hostnames are global (DNS), so this is the one cross-tenant read of org_domains.
CREATE FUNCTION tenancy.org_by_host(p_host text)
RETURNS TABLE (org_id uuid, primary_host text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT d.org_id,
         (SELECT p.hostname FROM tenancy.org_domains p
           WHERE p.org_id = d.org_id AND p.kind = 'site' AND p.is_primary)
  FROM tenancy.org_domains d
  JOIN tenancy.organizations o ON o.id = d.org_id
  WHERE d.hostname = lower(p_host) AND d.kind = 'site' AND d.status = 'active'
    AND o.status IN ('active', 'limited')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.org_by_host(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.org_by_host(text) TO app_user;
