CREATE TABLE "billing"."features" (
	"module_key" text PRIMARY KEY NOT NULL,
	"provider_feature_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing"."provider_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "provider_events_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "billing_provider_events_provider_check" CHECK (provider in ('fake', 'stripe'))
);
--> statement-breakpoint
ALTER TABLE "billing"."provider_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."provider_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."org_billing" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text,
	"provider_customer_id" text,
	"legacy_fees_grandfathered" boolean DEFAULT false NOT NULL,
	"grandfathered_reason" text,
	"entitlements_synced_at" timestamp with time zone,
	CONSTRAINT "org_billing_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_billing_customer_check" CHECK ((provider is null) = (provider_customer_id is null)),
	CONSTRAINT "org_billing_provider_check" CHECK (provider is null or provider in ('fake', 'stripe')),
	CONSTRAINT "org_billing_grandfathered_check" CHECK ((legacy_fees_grandfathered = (grandfathered_reason is not null)) and (grandfathered_reason is null or grandfathered_reason in ('existing_org', 'legacy_migration', 'staff')))
);
--> statement-breakpoint
ALTER TABLE "billing"."org_billing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."org_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"module_key" text NOT NULL,
	"provider" text NOT NULL,
	CONSTRAINT "org_entitlements_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_entitlements_provider_check" CHECK (provider in ('fake', 'stripe'))
);
--> statement-breakpoint
ALTER TABLE "billing"."org_entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."org_entitlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."plan_catalog" (
	"plan_key" text PRIMARY KEY NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"provider_product_id" text,
	"synced_at" timestamp with time zone,
	CONSTRAINT "plan_catalog_sort_check" CHECK (sort_order between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "billing"."plan_prices" (
	"lookup_key" text PRIMARY KEY NOT NULL,
	"plan_key" text NOT NULL,
	"currency" text NOT NULL,
	"billing_interval" text NOT NULL,
	"unit_amount_minor" bigint,
	"active" boolean DEFAULT false NOT NULL,
	"provider_price_id" text,
	"synced_at" timestamp with time zone,
	CONSTRAINT "plan_prices_lookup_key_check" CHECK (lookup_key ~ '^[a-z0-9][a-z0-9_]{2,80}$'),
	CONSTRAINT "plan_prices_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "plan_prices_interval_check" CHECK (billing_interval in ('month', 'year')),
	CONSTRAINT "plan_prices_amount_check" CHECK (unit_amount_minor is null or unit_amount_minor >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing"."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"status" text NOT NULL,
	"plan_key" text,
	"price_lookup_key" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscriptions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "subscriptions_status_check" CHECK (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
	CONSTRAINT "subscriptions_provider_check" CHECK (provider in ('fake', 'stripe'))
);
--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."plan_catalog" ADD CONSTRAINT "plan_catalog_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "billing"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."plan_prices" ADD CONSTRAINT "plan_prices_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "billing"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "billing"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_events_org_id_idx" ON "billing"."provider_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_org_provider_event_key" ON "billing"."provider_events" USING btree ("org_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "org_billing_org_id_idx" ON "billing"."org_billing" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_billing_org_key" ON "billing"."org_billing" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_entitlements_org_id_idx" ON "billing"."org_entitlements" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_entitlements_org_module_key" ON "billing"."org_entitlements" USING btree ("org_id","module_key");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_idx" ON "billing"."subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_provider_sub_key" ON "billing"."subscriptions" USING btree ("org_id","provider","provider_subscription_id");--> statement-breakpoint
CREATE POLICY "provider_events_tenant_isolation" ON "billing"."provider_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "org_billing_tenant_isolation" ON "billing"."org_billing" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "org_entitlements_tenant_isolation" ON "billing"."org_entitlements" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_isolation" ON "billing"."subscriptions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.6a (P6-7): the plan catalog is reference data. app_user only reads it; the worker's catalog sync
-- writes it through billing.apply_catalog (platform_reader) and migrations seed it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON billing.plan_catalog, billing.plan_prices, billing.features FROM app_user;--> statement-breakpoint
GRANT SELECT ON billing.plan_catalog, billing.plan_prices, billing.features TO platform_reader;--> statement-breakpoint
-- The research tiers ($0/$29/$99/$249/Enterprise) as placeholders, switched off (D22: the owner
-- prices plans with launch data). Mirrors PLACEHOLDER_PLANS in packages/modules/billing/src/catalog.ts.
INSERT INTO billing.plans (key, name) VALUES
  ('tier_free', 'Free'),
  ('tier_starter', 'Starter'),
  ('tier_pro', 'Pro'),
  ('tier_agency', 'Agency'),
  ('tier_enterprise', 'Enterprise')
  ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
INSERT INTO billing.plan_catalog (plan_key, sort_order, active) VALUES
  ('tier_free', 1, false),
  ('tier_starter', 2, false),
  ('tier_pro', 3, false),
  ('tier_agency', 4, false),
  ('tier_enterprise', 5, false)
  ON CONFLICT (plan_key) DO NOTHING;--> statement-breakpoint
INSERT INTO billing.plan_prices (lookup_key, plan_key, currency, billing_interval, unit_amount_minor, active) VALUES
  ('tier_free_month_usd', 'tier_free', 'USD', 'month', 0, false),
  ('tier_starter_month_usd', 'tier_starter', 'USD', 'month', 2900, false),
  ('tier_starter_year_usd', 'tier_starter', 'USD', 'year', 29000, false),
  ('tier_pro_month_usd', 'tier_pro', 'USD', 'month', 9900, false),
  ('tier_pro_year_usd', 'tier_pro', 'USD', 'year', 99000, false),
  ('tier_agency_month_usd', 'tier_agency', 'USD', 'month', 24900, false),
  ('tier_agency_year_usd', 'tier_agency', 'USD', 'year', 249000, false),
  ('tier_enterprise_year_usd', 'tier_enterprise', 'USD', 'year', NULL, false)
  ON CONFLICT (lookup_key) DO NOTHING;--> statement-breakpoint
INSERT INTO billing.plan_modules (plan_key, module_key) VALUES
  ('tier_free', 'core'),
  ('tier_free', 'events'),
  ('tier_free', 'ticketing'),
  ('tier_free', 'orders'),
  ('tier_free', 'attendees'),
  ('tier_free', 'checkin'),
  ('tier_free', 'seating'),
  ('tier_free', 'seat_finder'),
  ('tier_free', 'guests'),
  ('tier_free', 'rsvp'),
  ('tier_free', 'access_codes'),
  ('tier_free', 'marketing'),
  ('tier_free', 'messaging'),
  ('tier_free', 'reports'),
  ('tier_free', 'ai'),
  ('tier_free', 'chat'),
  ('tier_free', 'donations'),
  ('tier_free', 'gallery'),
  ('tier_free', 'website'),
  ('tier_free', 'api_access'),
  ('tier_starter', 'core'),
  ('tier_starter', 'events'),
  ('tier_starter', 'ticketing'),
  ('tier_starter', 'orders'),
  ('tier_starter', 'attendees'),
  ('tier_starter', 'checkin'),
  ('tier_starter', 'seating'),
  ('tier_starter', 'seat_finder'),
  ('tier_starter', 'guests'),
  ('tier_starter', 'rsvp'),
  ('tier_starter', 'access_codes'),
  ('tier_starter', 'marketing'),
  ('tier_starter', 'messaging'),
  ('tier_starter', 'reports'),
  ('tier_starter', 'ai'),
  ('tier_starter', 'chat'),
  ('tier_starter', 'donations'),
  ('tier_starter', 'gallery'),
  ('tier_starter', 'website'),
  ('tier_starter', 'api_access'),
  ('tier_starter', 'distribution'),
  ('tier_starter', 'registration'),
  ('tier_starter', 'whitelabel'),
  ('tier_pro', 'core'),
  ('tier_pro', 'events'),
  ('tier_pro', 'ticketing'),
  ('tier_pro', 'orders'),
  ('tier_pro', 'attendees'),
  ('tier_pro', 'checkin'),
  ('tier_pro', 'seating'),
  ('tier_pro', 'seat_finder'),
  ('tier_pro', 'guests'),
  ('tier_pro', 'rsvp'),
  ('tier_pro', 'access_codes'),
  ('tier_pro', 'marketing'),
  ('tier_pro', 'messaging'),
  ('tier_pro', 'reports'),
  ('tier_pro', 'ai'),
  ('tier_pro', 'chat'),
  ('tier_pro', 'donations'),
  ('tier_pro', 'gallery'),
  ('tier_pro', 'website'),
  ('tier_pro', 'api_access'),
  ('tier_pro', 'distribution'),
  ('tier_pro', 'registration'),
  ('tier_pro', 'whitelabel'),
  ('tier_pro', 'sessions'),
  ('tier_pro', 'speakers'),
  ('tier_pro', 'integrations'),
  ('tier_pro', 'advanced_seating'),
  ('tier_agency', 'core'),
  ('tier_agency', 'events'),
  ('tier_agency', 'ticketing'),
  ('tier_agency', 'orders'),
  ('tier_agency', 'attendees'),
  ('tier_agency', 'checkin'),
  ('tier_agency', 'seating'),
  ('tier_agency', 'seat_finder'),
  ('tier_agency', 'guests'),
  ('tier_agency', 'rsvp'),
  ('tier_agency', 'access_codes'),
  ('tier_agency', 'marketing'),
  ('tier_agency', 'messaging'),
  ('tier_agency', 'reports'),
  ('tier_agency', 'ai'),
  ('tier_agency', 'chat'),
  ('tier_agency', 'donations'),
  ('tier_agency', 'gallery'),
  ('tier_agency', 'website'),
  ('tier_agency', 'api_access'),
  ('tier_agency', 'distribution'),
  ('tier_agency', 'registration'),
  ('tier_agency', 'whitelabel'),
  ('tier_agency', 'sessions'),
  ('tier_agency', 'speakers'),
  ('tier_agency', 'integrations'),
  ('tier_agency', 'advanced_seating'),
  ('tier_agency', 'agency'),
  ('tier_agency', 'analytics_pro'),
  ('tier_enterprise', 'core'),
  ('tier_enterprise', 'events'),
  ('tier_enterprise', 'ticketing'),
  ('tier_enterprise', 'orders'),
  ('tier_enterprise', 'attendees'),
  ('tier_enterprise', 'checkin'),
  ('tier_enterprise', 'seating'),
  ('tier_enterprise', 'seat_finder'),
  ('tier_enterprise', 'guests'),
  ('tier_enterprise', 'rsvp'),
  ('tier_enterprise', 'access_codes'),
  ('tier_enterprise', 'marketing'),
  ('tier_enterprise', 'messaging'),
  ('tier_enterprise', 'reports'),
  ('tier_enterprise', 'ai'),
  ('tier_enterprise', 'chat'),
  ('tier_enterprise', 'donations'),
  ('tier_enterprise', 'gallery'),
  ('tier_enterprise', 'website'),
  ('tier_enterprise', 'api_access'),
  ('tier_enterprise', 'distribution'),
  ('tier_enterprise', 'registration'),
  ('tier_enterprise', 'whitelabel'),
  ('tier_enterprise', 'sessions'),
  ('tier_enterprise', 'speakers'),
  ('tier_enterprise', 'integrations'),
  ('tier_enterprise', 'advanced_seating'),
  ('tier_enterprise', 'agency'),
  ('tier_enterprise', 'analytics_pro'),
  ('tier_enterprise', 'exhibitors'),
  ('tier_enterprise', 'sponsors'),
  ('tier_enterprise', 'badges'),
  ('tier_enterprise', 'enterprise'),
  ('tier_enterprise', 'virtual'),
  ('tier_enterprise', 'ai_seating')
  ON CONFLICT DO NOTHING;--> statement-breakpoint
-- A tier charges the legacy per-ticket fees until the owner sets its own (D22), so a plan change
-- never moves an org's fees by accident.
INSERT INTO billing.fee_schedules (plan_key, currency, percent_bps, fixed_minor)
  SELECT p.key, f.currency, f.percent_bps, f.fixed_minor
  FROM billing.fee_schedules f
  CROSS JOIN (VALUES ('tier_free'), ('tier_starter'), ('tier_pro'), ('tier_agency'), ('tier_enterprise')) AS p (key)
  WHERE f.plan_key = 'launch_standard'
  ON CONFLICT DO NOTHING;--> statement-breakpoint
-- P6-13: every Phase 6 capability has a module key now; free within quotas in beta.
INSERT INTO billing.plan_modules (plan_key, module_key) VALUES
  ('launch_standard', 'api_access'),
  ('launch_standard', 'integrations'),
  ('launch_standard', 'enterprise'),
  ('launch_standard', 'agency'),
  ('launch_standard', 'virtual'),
  ('launch_standard', 'advanced_seating'),
  ('launch_standard', 'ai_seating'),
  ('launch_standard', 'analytics_pro')
  ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Legacy fee grandfathering (P6-7): every org that exists today keeps its per-ticket fees when
-- subscriptions switch on (orgs from the legacy migration are flagged by its T2 transform).
INSERT INTO billing.org_billing (org_id, legacy_fees_grandfathered, grandfathered_reason)
  SELECT o.id, true, CASE WHEN o.legacy_instance IS NULL THEN 'existing_org' ELSE 'legacy_migration' END
  FROM tenancy.organizations o
  ON CONFLICT (org_id) DO NOTHING;--> statement-breakpoint
-- The org a billing customer belongs to (the billing webhook resolves the provider's customer id).
-- Null when no org, or more than one, has it.
CREATE FUNCTION billing.org_for_customer(p_provider text, p_customer text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN count(*) = 1 THEN (min(b.org_id::text))::uuid END
  FROM billing.org_billing b
  WHERE b.provider = p_provider AND b.provider_customer_id = p_customer
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.org_for_customer(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.org_for_customer(text, text) TO app_user;--> statement-breakpoint
-- Mirror the billing provider's catalog (the worker's sync, platform_reader): plans from products
-- (`plan_key` metadata), their modules from the products' Entitlement Features, prices by lookup
-- key, features by module key. Objects gone from the provider are switched off, never deleted.
-- The legacy `launch_standard` plan is never touched. Returns what it applied.
CREATE FUNCTION billing.apply_catalog(p_catalog jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v jsonb;
  n_plans integer := 0;
  n_prices integer := 0;
  n_features integer := 0;
BEGIN
  IF jsonb_typeof(p_catalog) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'apply_catalog: the catalog must be an object';
  END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(coalesce(p_catalog -> 'plans', '[]'::jsonb)) LOOP
    IF (v ->> 'key') IS NULL OR (v ->> 'key') !~ '^[a-z][a-z0-9_]{2,40}$' OR (v ->> 'key') = 'launch_standard' THEN
      RAISE EXCEPTION 'apply_catalog: plan key not allowed: %', v ->> 'key';
    END IF;
    INSERT INTO billing.plans (key, name) VALUES (v ->> 'key', left(coalesce(v ->> 'name', v ->> 'key'), 100))
      ON CONFLICT (key) DO UPDATE SET name = excluded.name;
    INSERT INTO billing.plan_catalog (plan_key, sort_order, active, provider_product_id, synced_at)
      VALUES (v ->> 'key', (v ->> 'sortOrder')::integer, (v ->> 'active')::boolean, v ->> 'productId', now())
      ON CONFLICT (plan_key) DO UPDATE SET
        sort_order = excluded.sort_order, active = excluded.active,
        provider_product_id = excluded.provider_product_id, synced_at = excluded.synced_at;
    DELETE FROM billing.plan_modules WHERE plan_key = v ->> 'key';
    INSERT INTO billing.plan_modules (plan_key, module_key)
      SELECT v ->> 'key', m FROM jsonb_array_elements_text(coalesce(v -> 'modules', '[]'::jsonb)) AS m
      ON CONFLICT DO NOTHING;
    INSERT INTO billing.fee_schedules (plan_key, currency, percent_bps, fixed_minor)
      SELECT v ->> 'key', f.currency, f.percent_bps, f.fixed_minor
      FROM billing.fee_schedules f WHERE f.plan_key = 'launch_standard'
      ON CONFLICT DO NOTHING;
    n_plans := n_plans + 1;
  END LOOP;
  UPDATE billing.plan_catalog c SET active = false, synced_at = now()
  WHERE c.active AND c.plan_key NOT IN (
    SELECT x ->> 'key' FROM jsonb_array_elements(coalesce(p_catalog -> 'plans', '[]'::jsonb)) AS x
  );
  FOR v IN SELECT * FROM jsonb_array_elements(coalesce(p_catalog -> 'prices', '[]'::jsonb)) LOOP
    INSERT INTO billing.plan_prices
      (lookup_key, plan_key, currency, billing_interval, unit_amount_minor, active, provider_price_id, synced_at)
    VALUES (
      v ->> 'lookupKey', v ->> 'planKey', v ->> 'currency', v ->> 'interval',
      (v ->> 'unitAmountMinor')::bigint, (v ->> 'active')::boolean, v ->> 'priceId', now()
    )
    ON CONFLICT (lookup_key) DO UPDATE SET
      plan_key = excluded.plan_key, currency = excluded.currency,
      billing_interval = excluded.billing_interval, unit_amount_minor = excluded.unit_amount_minor,
      active = excluded.active, provider_price_id = excluded.provider_price_id, synced_at = excluded.synced_at;
    n_prices := n_prices + 1;
  END LOOP;
  UPDATE billing.plan_prices p SET active = false, synced_at = now()
  WHERE p.active AND p.lookup_key NOT IN (
    SELECT x ->> 'lookupKey' FROM jsonb_array_elements(coalesce(p_catalog -> 'prices', '[]'::jsonb)) AS x
  );
  FOR v IN SELECT * FROM jsonb_array_elements(coalesce(p_catalog -> 'features', '[]'::jsonb)) LOOP
    INSERT INTO billing.features (module_key, provider_feature_id, active, synced_at)
      VALUES (v ->> 'moduleKey', v ->> 'featureId', (v ->> 'active')::boolean, now())
      ON CONFLICT (module_key) DO UPDATE SET
        provider_feature_id = excluded.provider_feature_id, active = excluded.active, synced_at = excluded.synced_at;
    n_features := n_features + 1;
  END LOOP;
  UPDATE billing.features f SET active = false, synced_at = now()
  WHERE f.active AND f.module_key NOT IN (
    SELECT x ->> 'moduleKey' FROM jsonb_array_elements(coalesce(p_catalog -> 'features', '[]'::jsonb)) AS x
  );
  RETURN jsonb_build_object('plans', n_plans, 'prices', n_prices, 'features', n_features);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.apply_catalog(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.apply_catalog(jsonb) TO platform_reader;
-- hand-written: end
