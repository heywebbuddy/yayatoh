-- Ticketing (M1.5a): event FK (composite, down the tiers), launch fee schedule rows, and the
-- public passes read path.
ALTER TABLE ticketing.ticket_types
  ADD CONSTRAINT ticket_types_event_fk FOREIGN KEY (org_id, event_id)
  REFERENCES events.events (org_id, id) ON DELETE CASCADE;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON billing.fee_schedules FROM app_user;
--> statement-breakpoint
-- Seeded at 0 until the owner confirms today's legacy commission (owner inbox, M1.5).
INSERT INTO billing.fee_schedules (plan_key, currency, percent_bps, fixed_minor) VALUES
  ('launch_standard', 'USD', 0, 0),
  ('launch_standard', 'CAD', 0, 0),
  ('launch_standard', 'EUR', 0, 0),
  ('launch_standard', 'GBP', 0, 0);
--> statement-breakpoint
CREATE FUNCTION ticketing.public_ticket_types(p_event_slug text)
RETURNS TABLE (
  id uuid, name text, description text, price_minor bigint, currency text, fee_mode text,
  remaining integer, sales_start_at timestamptz, sales_end_at timestamptz,
  min_per_order integer, max_per_order integer, percent_bps integer, fixed_minor bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.id, t.name, t.description, t.price_minor, t.currency, t.fee_mode,
         t.quantity_total - t.quantity_sold - t.quantity_held,
         t.sales_start_at, t.sales_end_at, t.min_per_order, t.max_per_order,
         coalesce(ov.percent_bps, fs.percent_bps, 0), coalesce(ov.fixed_minor, fs.fixed_minor, 0)
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
REVOKE ALL ON FUNCTION ticketing.public_ticket_types(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.public_ticket_types(text) TO app_user;
