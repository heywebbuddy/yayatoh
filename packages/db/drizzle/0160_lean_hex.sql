CREATE TABLE "billing"."agency_billing" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grant_id" uuid NOT NULL,
	"agency_org_id" uuid NOT NULL,
	"commission_bps" integer NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" text,
	CONSTRAINT "agency_billing_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "agency_billing_commission_check" CHECK (commission_bps between 0 and 5000),
	CONSTRAINT "agency_billing_not_self" CHECK (agency_org_id <> org_id),
	CONSTRAINT "agency_billing_end_check" CHECK ((ended_at is null) = (end_reason is null) and (end_reason is null or end_reason in ('client', 'agency', 'grant_revoked', 'staff')))
);
--> statement-breakpoint
ALTER TABLE "billing"."agency_billing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."agency_billing" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."agency_billing_offers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"offered_by" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	CONSTRAINT "agency_billing_offers_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "agency_billing_offers_not_self" CHECK (client_org_id <> org_id)
);
--> statement-breakpoint
ALTER TABLE "billing"."agency_billing_offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."agency_billing_offers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."postings" DROP CONSTRAINT "postings_account_check";--> statement-breakpoint
ALTER TABLE "payments"."settlements" DROP CONSTRAINT "settlements_kind_check";--> statement-breakpoint
ALTER TABLE "payments"."settlements" ADD COLUMN "agency_org_id" uuid;--> statement-breakpoint
CREATE INDEX "agency_billing_org_id_idx" ON "billing"."agency_billing" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_billing_org_live_key" ON "billing"."agency_billing" USING btree ("org_id") WHERE ended_at is null;--> statement-breakpoint
CREATE INDEX "agency_billing_org_accepted_idx" ON "billing"."agency_billing" USING btree ("org_id","accepted_at");--> statement-breakpoint
CREATE INDEX "agency_billing_offers_org_id_idx" ON "billing"."agency_billing_offers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_billing_offers_org_client_live_key" ON "billing"."agency_billing_offers" USING btree ("org_id","client_org_id") WHERE withdrawn_at is null;--> statement-breakpoint
CREATE INDEX "agency_billing_offers_org_created_idx" ON "billing"."agency_billing_offers" USING btree ("org_id","created_at");--> statement-breakpoint
-- hand-written: begin (M6.8a: existing tables, NOT VALID + VALIDATE keeps the lock short)
ALTER TABLE "payments"."postings" ADD CONSTRAINT "postings_account_check" CHECK (account in ('platform:stripe_cash', 'platform:platform_fee_deferred', 'platform:platform_fee_revenue', 'platform:processing_fee_expense', 'org:payable_held', 'org:payable_releasable', 'org:reserve', 'org:receivable', 'agency:commission_held', 'agency:commission_receivable', 'agency:commission_due', 'agency:commission_earned', 'agency:commission_paid', 'agency:commission_clawback')) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments"."settlements" ADD CONSTRAINT "settlements_agency_check" CHECK ((kind = 'commission') = (agency_org_id is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments"."settlements" ADD CONSTRAINT "settlements_kind_check" CHECK (kind in ('event', 'reserve', 'commission')) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments"."postings" VALIDATE CONSTRAINT "postings_account_check";--> statement-breakpoint
ALTER TABLE "payments"."settlements" VALIDATE CONSTRAINT "settlements_agency_check";--> statement-breakpoint
ALTER TABLE "payments"."settlements" VALIDATE CONSTRAINT "settlements_kind_check";--> statement-breakpoint
-- hand-written: end

CREATE POLICY "agency_billing_tenant_isolation" ON "billing"."agency_billing" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "agency_billing_offers_tenant_isolation" ON "billing"."agency_billing_offers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M6.8a: cross-org reads for agency billing, SECURITY DEFINER, allowlisted columns; the org comes from the transaction)
-- Internal (not granted): does an org have a module key (its plan or a grant override, minus a revoke)?
CREATE FUNCTION billing.org_has_module(p_org uuid, p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT (
    EXISTS (SELECT 1 FROM billing.plan_modules pm
      WHERE pm.module_key = p_key
        AND pm.plan_key = coalesce((SELECT op.plan_key FROM billing.org_plans op WHERE op.org_id = p_org LIMIT 1), 'launch_standard'))
    OR EXISTS (SELECT 1 FROM billing.entitlement_overrides o
      WHERE o.org_id = p_org AND o.module_key = p_key AND o.effect = 'grant' AND (o.expires_at IS NULL OR o.expires_at > now()))
  ) AND NOT EXISTS (SELECT 1 FROM billing.entitlement_overrides o
      WHERE o.org_id = p_org AND o.module_key = p_key AND o.effect = 'revoke' AND (o.expires_at IS NULL OR o.expires_at > now()))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.org_has_module(uuid, text) FROM PUBLIC;--> statement-breakpoint
-- Offers to pay this (client) org's plan from agencies it gave live access to, with the agency entitlement.
CREATE FUNCTION billing.agency_offers_for_me()
RETURNS TABLE (agency_org_id uuid, grant_id uuid, offered_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT f.org_id, g.id, f.created_at
  FROM billing.agency_billing_offers f
  JOIN tenancy.org_access_grants g ON g.agency_org_id = f.org_id AND g.org_id = f.client_org_id AND g.revoked_at IS NULL
  JOIN tenancy.organizations a ON a.id = f.org_id AND a.kind = 'agency' AND a.status IN ('active', 'limited')
  WHERE f.client_org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND f.withdrawn_at IS NULL AND billing.org_has_module(f.org_id, 'agency')
  ORDER BY f.created_at, f.org_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.agency_offers_for_me() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.agency_offers_for_me() TO app_user;--> statement-breakpoint
-- This (client) org's agency billing in force: its live acceptance, the grant still live, the offer
-- not withdrawn, the agency a live agency org with the agency entitlement. At most one row.
CREATE FUNCTION billing.agency_billing_active()
RETURNS TABLE (billing_id uuid, agency_org_id uuid, grant_id uuid, commission_bps integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.id, b.agency_org_id, b.grant_id, b.commission_bps
  FROM billing.agency_billing b
  JOIN tenancy.org_access_grants g ON g.id = b.grant_id AND g.org_id = b.org_id AND g.agency_org_id = b.agency_org_id AND g.revoked_at IS NULL
  JOIN tenancy.organizations a ON a.id = b.agency_org_id AND a.kind = 'agency' AND a.status IN ('active', 'limited')
  WHERE b.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND b.ended_at IS NULL
    AND EXISTS (SELECT 1 FROM billing.agency_billing_offers f
      WHERE f.org_id = b.agency_org_id AND f.client_org_id = b.org_id AND f.withdrawn_at IS NULL)
    AND billing.org_has_module(b.agency_org_id, 'agency')
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.agency_billing_active() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.agency_billing_active() TO app_user;--> statement-breakpoint
-- The modules the paying agency's plan gives this (client) org: its synced entitlements when billing
-- is on and its subscription is live (p_live), else its plan's modules; never the agency's own
-- agency keys, and nothing while the agency is read-only for an unpaid subscription.
CREATE FUNCTION billing.agency_cover_modules(p_live boolean)
RETURNS TABLE (module_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH a AS (SELECT agency_org_id AS id FROM billing.agency_billing_active()),
  ok AS (
    SELECT a.id FROM a WHERE NOT EXISTS (
      SELECT 1 FROM billing.org_billing ob WHERE ob.org_id = a.id
        AND ((ob.read_only_at IS NOT NULL AND ob.read_only_at <= now()) OR (ob.grace_ends_at IS NOT NULL AND ob.grace_ends_at <= now())))
  ),
  live AS (
    SELECT ok.id, p_live AND EXISTS (SELECT 1 FROM billing.org_billing ob WHERE ob.org_id = ok.id
        AND ob.provider_customer_id IS NOT NULL AND ob.entitlements_synced_at IS NOT NULL)
      AND EXISTS (SELECT 1 FROM billing.subscriptions s WHERE s.org_id = ok.id AND s.status IN ('trialing', 'active', 'past_due')) AS synced
    FROM ok
  )
  SELECT x.module_key FROM (
    SELECT e.module_key FROM live JOIN billing.org_entitlements e ON e.org_id = live.id WHERE live.synced
    UNION
    SELECT pm.module_key FROM live JOIN billing.plan_modules pm
      ON pm.plan_key = coalesce((SELECT op.plan_key FROM billing.org_plans op WHERE op.org_id = live.id LIMIT 1), 'launch_standard')
    WHERE NOT live.synced
  ) x WHERE x.module_key <> 'agency'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.agency_cover_modules(boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.agency_cover_modules(boolean) TO app_user;--> statement-breakpoint
-- Does this (agency) org hold a live grant from p_client? Only a boolean.
CREATE FUNCTION billing.agency_client_live(p_client uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM tenancy.org_access_grants g
    JOIN tenancy.organizations a ON a.id = g.agency_org_id AND a.kind = 'agency'
    WHERE g.org_id = p_client AND g.revoked_at IS NULL
      AND g.agency_org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.agency_client_live(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.agency_client_live(uuid) TO app_user;--> statement-breakpoint
-- The clients that accepted this (agency) org's offer: terms and state only, no client data.
CREATE FUNCTION billing.agency_billed_clients()
RETURNS TABLE (client_org_id uuid, commission_bps integer, accepted_at timestamptz, ended_at timestamptz, end_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.org_id, b.commission_bps, b.accepted_at, b.ended_at, b.end_reason
  FROM billing.agency_billing b
  WHERE b.agency_org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  ORDER BY b.accepted_at DESC, b.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.agency_billed_clients() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.agency_billed_clients() TO app_user;--> statement-breakpoint
-- An agency's payout destination for a commission transfer from this (client) org: only an agency
-- this org has (or had) agency billing with; only the account id and its new-destination hold.
CREATE FUNCTION payments.agency_payout_destination(p_agency uuid)
RETURNS TABLE (account_id text, destination_hold_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT pa.account_id, pa.destination_hold_until FROM payments.payment_accounts pa
  WHERE pa.org_id = p_agency AND pa.payouts_enabled AND NOT pa.payouts_held
    AND EXISTS (SELECT 1 FROM billing.agency_billing b
      WHERE b.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND b.agency_org_id = p_agency)
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION payments.agency_payout_destination(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION payments.agency_payout_destination(uuid) TO app_user;
-- hand-written: end
