ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "early_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "early_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "is_donation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "access_dates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD CONSTRAINT "ticket_types_early_check" CHECK ((early_price_minor is null) = (early_ends_at is null) and (early_price_minor is null or (early_price_minor >= 0 and early_price_minor < price_minor))) NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD CONSTRAINT "ticket_types_donation_check" CHECK (not is_donation or early_price_minor is null) NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD CONSTRAINT "ticket_types_access_dates_check" CHECK (jsonb_typeof(access_dates) = 'array') NOT VALID;--> statement-breakpoint
-- Existing table: constraints were added NOT VALID (brief lock), validated here.
ALTER TABLE "ticketing"."ticket_types" VALIDATE CONSTRAINT "ticket_types_early_check";--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" VALIDATE CONSTRAINT "ticket_types_donation_check";--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" VALIDATE CONSTRAINT "ticket_types_access_dates_check";--> statement-breakpoint
-- Public passes v2 (expand): adds early-bird, donation and access dates. v1 stays until nothing
-- calls it (contract step in a later migration).
CREATE FUNCTION ticketing.public_ticket_types_v2(p_event_slug text)
RETURNS TABLE (
  id uuid, name text, description text, price_minor bigint, currency text, fee_mode text,
  remaining integer, sales_start_at timestamptz, sales_end_at timestamptz,
  min_per_order integer, max_per_order integer, percent_bps integer, fixed_minor bigint,
  early_price_minor bigint, early_ends_at timestamptz, is_donation boolean, access_dates jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.id, t.name, t.description, t.price_minor, t.currency, t.fee_mode,
         t.quantity_total - t.quantity_sold - t.quantity_held,
         t.sales_start_at, t.sales_end_at, t.min_per_order, t.max_per_order,
         coalesce(ov.percent_bps, fs.percent_bps, 0), coalesce(ov.fixed_minor, fs.fixed_minor, 0),
         t.early_price_minor, t.early_ends_at, t.is_donation, t.access_dates
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  JOIN ticketing.ticket_types t ON t.org_id = e.org_id AND t.event_id = e.id
  LEFT JOIN billing.org_fee_overrides ov ON ov.org_id = e.org_id AND ov.currency = t.currency
  LEFT JOIN billing.fee_schedules fs ON fs.currency = t.currency
    AND fs.plan_key = coalesce((SELECT p.plan_key FROM billing.org_plans p WHERE p.org_id = e.org_id LIMIT 1), 'launch_standard')
  WHERE e.slug = lower(p_event_slug)
    AND e.status = 'published'
    AND e.visibility IN ('public', 'unlisted')
    AND t.visibility = 'public'
    AND t.archived_at IS NULL
  ORDER BY t.sort_order, t.created_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ticketing.public_ticket_types_v2(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.public_ticket_types_v2(text) TO app_user;
