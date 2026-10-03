CREATE SCHEMA "sso";
--> statement-breakpoint
CREATE TABLE "sso"."connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"protocol" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"idp_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_secret_sealed" text,
	"default_role" text DEFAULT 'viewer' NOT NULL,
	"jit" boolean DEFAULT true NOT NULL,
	"config_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_reason" text,
	"created_by" uuid,
	CONSTRAINT "connections_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "connections_protocol_check" CHECK (protocol in ('saml', 'oidc')),
	CONSTRAINT "connections_status_check" CHECK (status in ('draft', 'active', 'disabled')),
	CONSTRAINT "connections_default_role_check" CHECK (default_role in ('admin', 'manager', 'finance', 'marketing', 'box_office', 'scanner', 'viewer')),
	CONSTRAINT "connections_name_check" CHECK (length(btrim(name)) between 1 and 80),
	CONSTRAINT "connections_test_reason_check" CHECK (length(last_test_reason) <= 200)
);
--> statement-breakpoint
ALTER TABLE "sso"."connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sso"."connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sso"."domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token" text NOT NULL,
	"enforced" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "domains_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "domains_status_check" CHECK (status in ('pending', 'verified', 'failed')),
	CONSTRAINT "domains_enforced_check" CHECK (not enforced or status = 'verified'),
	CONSTRAINT "domains_domain_check" CHECK (domain = lower(domain) and length(domain) between 4 and 253 and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
	CONSTRAINT "domains_token_check" CHECK (length(token) between 32 and 200),
	CONSTRAINT "domains_failure_check" CHECK (length(failure_reason) <= 200)
);
--> statement-breakpoint
ALTER TABLE "sso"."domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sso"."domains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sso"."identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"user_id" uuid NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	CONSTRAINT "identities_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "identities_subject_check" CHECK (length(subject) between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "sso"."identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sso"."identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sso"."scim_group_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"group_id" uuid NOT NULL,
	"scim_user_id" uuid NOT NULL,
	CONSTRAINT "scim_group_members_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "sso"."scim_group_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sso"."scim_group_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sso"."scim_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" text NOT NULL,
	"external_id" text,
	"role" text,
	CONSTRAINT "scim_groups_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "scim_groups_role_check" CHECK (role is null or role in ('admin', 'manager', 'finance', 'marketing', 'box_office', 'scanner', 'viewer')),
	CONSTRAINT "scim_groups_name_check" CHECK (length(btrim(display_name)) between 1 and 200),
	CONSTRAINT "scim_groups_external_check" CHECK (external_id is null or length(external_id) between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "sso"."scim_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sso"."scim_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sso"."scim_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "scim_tokens_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "scim_tokens_hash_check" CHECK (length(token_hash) between 64 and 200),
	CONSTRAINT "scim_tokens_prefix_check" CHECK (prefix like 'yy_scim_%' and length(prefix) <= 200)
);
--> statement-breakpoint
ALTER TABLE "sso"."scim_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sso"."scim_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sso"."scim_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" text NOT NULL,
	"email" text NOT NULL,
	"external_id" text,
	"display_name" text,
	"given_name" text,
	"family_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"deprovisioned_at" timestamp with time zone,
	CONSTRAINT "scim_users_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "scim_users_user_name_check" CHECK (length(user_name) between 3 and 320),
	CONSTRAINT "scim_users_email_check" CHECK (length(email) between 3 and 320),
	CONSTRAINT "scim_users_external_check" CHECK (external_id is null or length(external_id) between 1 and 255),
	CONSTRAINT "scim_users_names_check" CHECK (coalesce(length(display_name), 0) <= 200 and coalesce(length(given_name), 0) <= 100 and coalesce(length(family_name), 0) <= 100)
);
--> statement-breakpoint
ALTER TABLE "sso"."scim_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sso"."scim_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "sso_org_id" uuid;--> statement-breakpoint
ALTER TABLE "sso"."identities" ADD CONSTRAINT "identities_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "sso"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso"."scim_group_members" ADD CONSTRAINT "scim_group_members_group_fk" FOREIGN KEY ("org_id","group_id") REFERENCES "sso"."scim_groups"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso"."scim_group_members" ADD CONSTRAINT "scim_group_members_user_fk" FOREIGN KEY ("org_id","scim_user_id") REFERENCES "sso"."scim_users"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_org_id_idx" ON "sso"."connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_org_key" ON "sso"."connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "domains_org_id_idx" ON "sso"."domains" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_org_domain_key" ON "sso"."domains" USING btree ("org_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_verified_key" ON "sso"."domains" USING btree ("domain") WHERE status = 'verified';--> statement-breakpoint
CREATE INDEX "identities_org_id_idx" ON "sso"."identities" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_org_subject_key" ON "sso"."identities" USING btree ("org_id","connection_id","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_org_user_key" ON "sso"."identities" USING btree ("org_id","connection_id","user_id");--> statement-breakpoint
CREATE INDEX "identities_org_user_idx" ON "sso"."identities" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "scim_group_members_org_id_idx" ON "sso"."scim_group_members" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_members_org_pair_key" ON "sso"."scim_group_members" USING btree ("org_id","group_id","scim_user_id");--> statement-breakpoint
CREATE INDEX "scim_group_members_org_user_idx" ON "sso"."scim_group_members" USING btree ("org_id","scim_user_id");--> statement-breakpoint
CREATE INDEX "scim_groups_org_id_idx" ON "sso"."scim_groups" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_groups_org_name_key" ON "sso"."scim_groups" USING btree ("org_id",lower("display_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "scim_groups_org_external_key" ON "sso"."scim_groups" USING btree ("org_id","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "scim_tokens_org_id_idx" ON "sso"."scim_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_tokens_hash_key" ON "sso"."scim_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_tokens_org_live_key" ON "sso"."scim_tokens" USING btree ("org_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "scim_users_org_id_idx" ON "sso"."scim_users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_users_org_user_key" ON "sso"."scim_users" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_users_org_user_name_key" ON "sso"."scim_users" USING btree ("org_id",lower("user_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "scim_users_org_external_key" ON "sso"."scim_users" USING btree ("org_id","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE POLICY "connections_tenant_isolation" ON "sso"."connections" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "domains_tenant_isolation" ON "sso"."domains" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "identities_tenant_isolation" ON "sso"."identities" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "scim_group_members_tenant_isolation" ON "sso"."scim_group_members" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "scim_groups_tenant_isolation" ON "sso"."scim_groups" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "scim_tokens_tenant_isolation" ON "sso"."scim_tokens" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "scim_users_tenant_isolation" ON "sso"."scim_users" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.5a: "Sign in with SSO" from an email address, before any tenant is known. Returns the org and
-- its active connection for a domain one org has verified (org active or limited), nothing else.
CREATE FUNCTION sso.connection_for_domain(p_domain text)
RETURNS TABLE (org_id uuid, connection_id uuid, org_slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT d.org_id, c.id, o.slug
  FROM sso.domains d
  JOIN sso.connections c ON c.org_id = d.org_id AND c.status = 'active'
  JOIN tenancy.organizations o ON o.id = d.org_id AND o.status IN ('active', 'limited')
  WHERE d.domain = lower(p_domain) AND d.status = 'verified'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sso.connection_for_domain(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sso.connection_for_domain(text) TO app_user;
--> statement-breakpoint
-- M6.5a: a SCIM bearer token (its SHA-256) → its org, while the token is live and the org active
-- or limited. The org comes from the token, never from a header.
CREATE FUNCTION sso.scim_token_by_hash(p_hash text)
RETURNS TABLE (org_id uuid, token_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.org_id, t.id
  FROM sso.scim_tokens t
  JOIN tenancy.organizations o ON o.id = t.org_id AND o.status IN ('active', 'limited')
  WHERE t.token_hash = p_hash AND t.revoked_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sso.scim_token_by_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sso.scim_token_by_hash(text) TO app_user;
--> statement-breakpoint
-- M6.5a: whether a person is active platform staff (one boolean). Single sign-on always asks staff
-- for their authenticator code (D14), so the web must know without reading platform.staff.
CREATE FUNCTION platform.is_staff(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM platform.staff s WHERE s.user_id = p_user_id AND s.revoked_at IS NULL)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.is_staff(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.is_staff(uuid) TO app_user;
-- hand-written: end
