CREATE SCHEMA "agency";
--> statement-breakpoint
CREATE TABLE "agency"."client_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"events_total" integer DEFAULT 0 NOT NULL,
	"events_upcoming" integer DEFAULT 0 NOT NULL,
	"events_live" integer DEFAULT 0 NOT NULL,
	"next_event_name" text,
	"next_event_at" timestamp with time zone,
	"orders_sold" integer DEFAULT 0 NOT NULL,
	"tickets_valid" integer DEFAULT 0 NOT NULL,
	"checkins" integer DEFAULT 0 NOT NULL,
	"campaigns" integer DEFAULT 0 NOT NULL,
	"sends" integer DEFAULT 0 NOT NULL,
	"deliveries" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"unique_clickers" integer DEFAULT 0 NOT NULL,
	"conversion_bps" integer DEFAULT 0 NOT NULL,
	"revenue" jsonb,
	"with_finance" boolean DEFAULT false NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "client_snapshots_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "client_snapshots_finance_check" CHECK (with_finance or revenue is null)
);
--> statement-breakpoint
ALTER TABLE "agency"."client_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency"."client_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency"."event_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"orders_sold" integer DEFAULT 0 NOT NULL,
	"tickets_valid" integer DEFAULT 0 NOT NULL,
	"checkins" integer DEFAULT 0 NOT NULL,
	"gross_minor" bigint,
	"currency" text NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_snapshots_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_snapshots_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "agency"."event_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency"."event_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."org_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agency_org_id" uuid NOT NULL,
	"role" text NOT NULL,
	"finance" boolean DEFAULT false NOT NULL,
	"granted_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "org_access_grants_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_access_grants_role_check" CHECK (role in ('manager', 'marketing', 'viewer')),
	CONSTRAINT "org_access_grants_not_self" CHECK (agency_org_id <> org_id),
	CONSTRAINT "org_access_grants_revoked_check" CHECK ((revoked_at is null) = (revoked_by is null))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."org_access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."org_access_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."org_access_grants" ADD CONSTRAINT "org_access_grants_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."org_access_grants" ADD CONSTRAINT "org_access_grants_agency_fk" FOREIGN KEY ("agency_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_snapshots_org_id_idx" ON "agency"."client_snapshots" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_snapshots_org_client_key" ON "agency"."client_snapshots" USING btree ("org_id","client_org_id");--> statement-breakpoint
CREATE INDEX "event_snapshots_org_id_idx" ON "agency"."event_snapshots" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_snapshots_org_client_event_key" ON "agency"."event_snapshots" USING btree ("org_id","client_org_id","event_id");--> statement-breakpoint
CREATE INDEX "org_access_grants_org_id_idx" ON "tenancy"."org_access_grants" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_access_grants_org_agency_live_key" ON "tenancy"."org_access_grants" USING btree ("org_id","agency_org_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "org_access_grants_agency_idx" ON "tenancy"."org_access_grants" USING btree ("agency_org_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE POLICY "client_snapshots_tenant_isolation" ON "agency"."client_snapshots" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_snapshots_tenant_isolation" ON "agency"."event_snapshots" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "org_access_grants_tenant_isolation" ON "tenancy"."org_access_grants" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M6.7a: cross-module foreign keys, down the tiers: agency 6 → tenancy 1)
ALTER TABLE "agency"."client_snapshots" ADD CONSTRAINT "client_snapshots_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency"."client_snapshots" ADD CONSTRAINT "client_snapshots_client_fk" FOREIGN KEY ("client_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency"."event_snapshots" ADD CONSTRAINT "event_snapshots_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency"."event_snapshots" ADD CONSTRAINT "event_snapshots_client_fk" FOREIGN KEY ("client_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M6.7a: agency access, SECURITY DEFINER functions returning allowlisted columns)
-- An agency by its address (the client grants it access): id, slug and name of a live agency org only.
CREATE FUNCTION tenancy.resolve_agency(p_slug text)
RETURNS TABLE (org_id uuid, slug text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.id, o.slug, o.name FROM tenancy.organizations o
  WHERE o.slug = lower(p_slug) AND o.kind = 'agency' AND o.status IN ('active', 'limited')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.resolve_agency(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.resolve_agency(text) TO app_user;--> statement-breakpoint
-- Agencies' address and name by id (the client's grant list): agency orgs only.
CREATE FUNCTION tenancy.agency_profiles(p_ids uuid[])
RETURNS TABLE (org_id uuid, slug text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.id, o.slug, o.name FROM tenancy.organizations o
  WHERE o.id = ANY (p_ids) AND o.kind = 'agency'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.agency_profiles(uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.agency_profiles(uuid[]) TO app_user;--> statement-breakpoint
-- The live grant through which the transaction's user acts in the transaction's org. Both come from
-- the transaction settings (withTenant), never from a parameter: the grant must be live, its agency
-- a live agency org, and the user a member of that agency (not a collaborator).
CREATE FUNCTION tenancy.agency_access()
RETURNS TABLE (grant_id uuid, agency_org_id uuid, agency_slug text, agency_name text, role text, finance boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT g.id, a.id, a.slug, a.name, g.role, g.finance
  FROM tenancy.org_access_grants g
  JOIN tenancy.organizations a ON a.id = g.agency_org_id AND a.kind = 'agency' AND a.status IN ('active', 'limited')
  JOIN tenancy.memberships m ON m.org_id = a.id AND m.role <> 'collaborator'
  WHERE g.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND m.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    AND g.revoked_at IS NULL
  ORDER BY g.created_at, g.id
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.agency_access() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.agency_access() TO app_user;--> statement-breakpoint
-- Client orgs a user reaches through the agencies they belong to (org switcher), except orgs they
-- are a direct member of. Allowlisted columns only.
CREATE FUNCTION tenancy.user_agency_clients(p_user uuid)
RETURNS TABLE (org_id uuid, slug text, name text, agency_org_id uuid, agency_name text, role text, finance boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT x.org_id, x.slug, x.name, x.agency_org_id, x.agency_name, x.role, x.finance FROM (
    SELECT DISTINCT ON (c.id) c.id AS org_id, c.slug, c.name, a.id AS agency_org_id, a.name AS agency_name,
      g.role, g.finance
    FROM tenancy.memberships m
    JOIN tenancy.organizations a ON a.id = m.org_id AND a.kind = 'agency' AND a.status IN ('active', 'limited')
    JOIN tenancy.org_access_grants g ON g.agency_org_id = a.id AND g.revoked_at IS NULL
    JOIN tenancy.organizations c ON c.id = g.org_id AND c.status <> 'terminated'
    WHERE m.user_id = p_user AND m.role <> 'collaborator'
      AND NOT EXISTS (SELECT 1 FROM tenancy.memberships d WHERE d.org_id = c.id AND d.user_id = p_user)
    ORDER BY c.id, g.created_at, g.id
  ) x
  ORDER BY x.name, x.org_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.user_agency_clients(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.user_agency_clients(uuid) TO app_user;--> statement-breakpoint
-- The live grants clients gave the transaction's org (the agency), with what its snapshot builder
-- and pages need about each client. The org comes from the transaction settings.
CREATE FUNCTION tenancy.agency_client_grants()
RETURNS TABLE (grant_id uuid, client_org_id uuid, slug text, name text, timezone text, currency text,
  status text, role text, finance boolean, granted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT g.id, c.id, c.slug, c.name, c.timezone, c.currency, c.status, g.role, g.finance, g.created_at
  FROM tenancy.org_access_grants g
  JOIN tenancy.organizations a ON a.id = g.agency_org_id AND a.kind = 'agency'
  JOIN tenancy.organizations c ON c.id = g.org_id AND c.status <> 'terminated'
  WHERE g.agency_org_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND g.revoked_at IS NULL
  ORDER BY c.name, c.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.agency_client_grants() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.agency_client_grants() TO app_user;--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M6.7a: money tables refuse rows to a user acting through an agency grant unless the client opted in to finance)
-- No agency grant in the transaction (members, buyers, API keys, system actors): allowed, the tenant
-- policy alone applies. Acting through a grant: only while that grant is live, in this org, with finance.
CREATE FUNCTION tenancy.money_access_allowed()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT NULLIF(current_setting('app.agency_grant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM tenancy.org_access_grants g
      WHERE g.id = NULLIF(current_setting('app.agency_grant_id', true), '')::uuid
        AND g.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
        AND g.revoked_at IS NULL AND g.finance
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.money_access_allowed() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.money_access_allowed() TO app_user;
--> statement-breakpoint
CREATE POLICY "disputes_agency_money_guard" ON "payments"."disputes" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "journal_entries_agency_money_guard" ON "payments"."journal_entries" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "legacy_settlements_agency_money_guard" ON "payments"."legacy_settlements" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "payment_accounts_agency_money_guard" ON "payments"."payment_accounts" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "postings_agency_money_guard" ON "payments"."postings" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "provider_events_agency_money_guard" ON "payments"."provider_events" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "reconciliation_items_agency_money_guard" ON "payments"."reconciliation_items" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "reconciliation_runs_agency_money_guard" ON "payments"."reconciliation_runs" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "settlements_agency_money_guard" ON "payments"."settlements" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "invoices_agency_money_guard" ON "orders"."invoices" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "invoice_payments_agency_money_guard" ON "orders"."invoice_payments" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "credit_notes_agency_money_guard" ON "orders"."credit_notes" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
--> statement-breakpoint
CREATE POLICY "credit_note_applications_agency_money_guard" ON "orders"."credit_note_applications" AS RESTRICTIVE FOR ALL TO "app_user" USING ((SELECT tenancy.money_access_allowed())) WITH CHECK ((SELECT tenancy.money_access_allowed()));
-- hand-written: end
