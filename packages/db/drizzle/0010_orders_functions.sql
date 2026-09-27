-- Orders and checkout (M1.5b): cross-module foreign keys (down the tiers) and the few
-- cross-tenant entry points, each returning ids only.
ALTER TABLE orders.orders
  ADD CONSTRAINT orders_event_fk FOREIGN KEY (org_id, event_id) REFERENCES events.events (org_id, id);
--> statement-breakpoint
ALTER TABLE orders.order_items
  ADD CONSTRAINT order_items_ticket_type_fk FOREIGN KEY (org_id, ticket_type_id) REFERENCES ticketing.ticket_types (org_id, id);
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON payments.provider_events FROM app_user;
--> statement-breakpoint
-- Public checkout: event slug → (org, event) for published, non-private events of active orgs.
CREATE FUNCTION events.checkout_target(p_slug text)
RETURNS TABLE (org_id uuid, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.org_id, e.id FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status = 'active'
  WHERE e.slug = lower(p_slug) AND e.status = 'published' AND e.visibility IN ('public', 'unlisted')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION events.checkout_target(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.checkout_target(text) TO app_user;
--> statement-breakpoint
-- Guest order page: manage-token hash → (org, order).
CREATE FUNCTION orders.order_ref_by_token(p_hash text)
RETURNS TABLE (org_id uuid, order_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.org_id, o.id FROM orders.orders o WHERE o.manage_token_hash = p_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orders.order_ref_by_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orders.order_ref_by_token(text) TO app_user;
--> statement-breakpoint
-- Hold sweeper (worker): which orgs have holds past their expiry.
CREATE FUNCTION orders.orgs_with_due_holds(p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT o.org_id FROM orders.orders o
  WHERE o.status IN ('reserved', 'awaiting_payment', 'payment_failed') AND o.expires_at <= now()
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orders.orgs_with_due_holds(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orders.orgs_with_due_holds(integer) TO platform_reader;
