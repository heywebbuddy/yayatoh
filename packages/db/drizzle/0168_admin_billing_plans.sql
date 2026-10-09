ALTER TABLE billing.plan_catalog ADD COLUMN managed_locally boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Keep the provider mirror, but preserve plans explicitly managed by staff.
ALTER FUNCTION billing.apply_catalog(jsonb) RENAME TO apply_provider_catalog;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION billing.apply_provider_catalog(jsonb) FROM platform_reader;
--> statement-breakpoint
CREATE FUNCTION billing.apply_catalog(p_catalog jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_plans jsonb; v_prices jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('billing.catalog'));
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', c.plan_key, 'name', p.name,
    'active', c.active, 'sortOrder', c.sort_order, 'productId', c.provider_product_id,
    'modules', (SELECT coalesce(jsonb_agg(module_key), '[]'::jsonb) FROM billing.plan_modules WHERE plan_key = c.plan_key))), '[]'::jsonb)
    INTO v_plans FROM billing.plan_catalog c JOIN billing.plans p ON p.key = c.plan_key WHERE c.managed_locally;
  SELECT coalesce(jsonb_agg(jsonb_build_object('lookupKey', p.lookup_key, 'planKey', p.plan_key,
    'currency', p.currency, 'interval', p.billing_interval, 'unitAmountMinor', p.unit_amount_minor,
    'active', p.active, 'priceId', p.provider_price_id)), '[]'::jsonb)
    INTO v_prices FROM billing.plan_prices p JOIN billing.plan_catalog c ON c.plan_key = p.plan_key WHERE c.managed_locally;
  RETURN billing.apply_provider_catalog(jsonb_build_object(
    'plans', v_plans || (SELECT coalesce(jsonb_agg(v), '[]'::jsonb) FROM jsonb_array_elements(coalesce(p_catalog->'plans', '[]'::jsonb)) v
      WHERE NOT EXISTS (SELECT 1 FROM billing.plan_catalog c WHERE c.managed_locally AND c.plan_key = v->>'key')),
    'prices', v_prices || (SELECT coalesce(jsonb_agg(v), '[]'::jsonb) FROM jsonb_array_elements(coalesce(p_catalog->'prices', '[]'::jsonb)) v
      WHERE NOT EXISTS (SELECT 1 FROM billing.plan_catalog c WHERE c.managed_locally AND c.plan_key = v->>'planKey')
        AND NOT EXISTS (SELECT 1 FROM billing.plan_prices p JOIN billing.plan_catalog c ON c.plan_key = p.plan_key WHERE c.managed_locally AND p.lookup_key = v->>'lookupKey')),
    'features', coalesce(p_catalog->'features', '[]'::jsonb)));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.apply_catalog(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.apply_catalog(jsonb) TO platform_reader;
--> statement-breakpoint
CREATE FUNCTION billing.admin_save_plan(p_plan jsonb, p_actor text, p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_key text := p_plan->>'key'; v jsonb;
BEGIN
  IF p_actor !~ '^staff:[0-9a-f-]{36}$' OR NOT EXISTS (
    SELECT 1 FROM platform.staff WHERE user_id = substring(p_actor FROM 7)::uuid AND role = 'admin' AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Active platform admin required'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 3 OR length(p_reason) > 500 THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]{2,40}$' OR v_key = 'launch_standard'
    OR length(trim(coalesce(p_plan->>'name', ''))) NOT BETWEEN 1 AND 100
    OR jsonb_array_length(p_plan->'modules') < 1 OR NOT (p_plan->'modules' @> '["core"]'::jsonb)
    OR jsonb_array_length(p_plan->'prices') NOT BETWEEN 1 AND 20
  THEN RAISE EXCEPTION 'Invalid plan'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('billing.catalog'));
  INSERT INTO billing.plans (key, name) VALUES (v_key, p_plan->>'name') ON CONFLICT (key) DO UPDATE SET name = excluded.name;
  INSERT INTO billing.plan_catalog (plan_key, sort_order, active, provider_product_id, managed_locally, synced_at)
    VALUES (v_key, (p_plan->>'sortOrder')::integer, (p_plan->>'active')::boolean, p_plan->>'productId', true, now())
    ON CONFLICT (plan_key) DO UPDATE SET sort_order = excluded.sort_order, active = excluded.active,
      provider_product_id = excluded.provider_product_id, managed_locally = true, synced_at = now();
  DELETE FROM billing.plan_modules WHERE plan_key = v_key;
  INSERT INTO billing.plan_modules (plan_key, module_key) SELECT v_key, m FROM jsonb_array_elements_text(p_plan->'modules') m;
  FOR v IN SELECT * FROM jsonb_array_elements(p_plan->'prices') LOOP
    IF EXISTS (SELECT 1 FROM billing.plan_prices WHERE lookup_key = v->>'lookupKey' AND plan_key <> v_key)
      THEN RAISE EXCEPTION 'Price key belongs to another plan'; END IF;
    IF EXISTS (SELECT 1 FROM billing.plan_prices p WHERE p.lookup_key = v->>'lookupKey'
      AND EXISTS (SELECT 1 FROM billing.subscriptions s WHERE s.price_lookup_key = p.lookup_key)
      AND (p.currency IS DISTINCT FROM v->>'currency' OR p.billing_interval IS DISTINCT FROM v->>'interval'
        OR p.unit_amount_minor IS DISTINCT FROM (v->>'unitAmountMinor')::bigint OR p.provider_price_id IS DISTINCT FROM v->>'priceId'))
      THEN RAISE EXCEPTION 'A subscribed price is immutable; create a new price key'; END IF;
    INSERT INTO billing.plan_prices (lookup_key, plan_key, currency, billing_interval, unit_amount_minor, active, provider_price_id, synced_at)
      VALUES (v->>'lookupKey', v_key, v->>'currency', v->>'interval', (v->>'unitAmountMinor')::bigint, (v->>'active')::boolean, v->>'priceId', now())
      ON CONFLICT (lookup_key) DO UPDATE SET currency = excluded.currency, billing_interval = excluded.billing_interval,
        unit_amount_minor = excluded.unit_amount_minor, active = excluded.active, provider_price_id = excluded.provider_price_id, synced_at = now();
  END LOOP;
  INSERT INTO billing.fee_schedules (plan_key, currency, percent_bps, fixed_minor)
    SELECT v_key, currency, percent_bps, fixed_minor FROM billing.fee_schedules WHERE plan_key = 'launch_standard' ON CONFLICT DO NOTHING;
  RETURN v_key;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing.admin_save_plan(jsonb, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.admin_save_plan(jsonb, text, text) TO platform_reader;
