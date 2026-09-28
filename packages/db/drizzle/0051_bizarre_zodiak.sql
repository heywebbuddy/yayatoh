-- hand-written: begin
-- M1.8f search: pg_trgm (a trusted extension, so the migrator can create it) in its own schema;
-- the operator class below is qualified with it. drizzle's migrator applies migrations inside one
-- transaction, so CREATE INDEX CONCURRENTLY is not possible here: on a large production table the
-- owner's runbook creates these four indexes CONCURRENTLY first (same names), and this migration
-- then finds them (IF NOT EXISTS) and does nothing.
CREATE SCHEMA IF NOT EXISTS "extensions";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA "extensions";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendees_name_trgm_idx" ON "attendees"."attendees" USING gin ("name" "extensions".gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendees_email_trgm_idx" ON "attendees"."attendees" USING gin ("email" "extensions".gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_buyer_name_trgm_idx" ON "orders"."orders" USING gin ("buyer_name" "extensions".gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_buyer_email_trgm_idx" ON "orders"."orders" USING gin ("buyer_email" "extensions".gin_trgm_ops);--> statement-breakpoint
-- Under row-level security the planner never uses an index for ILIKE: the operator is not
-- LEAKPROOF, so it may not run before the tenant policy. These functions run the same ILIKE for
-- the caller's own org (the same `app.org_id` setting the policy reads; unset = nothing) as the
-- owner, so the trigram indexes serve it, and return matching ids only. Callers keep their
-- query (and RLS) and add `id IN (these ids)`: results are identical to the plain ILIKE.
CREATE FUNCTION attendees.search_ids(p_pattern text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.id FROM attendees.attendees a
  WHERE a.org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)
    AND (a.name ILIKE p_pattern OR a.email ILIKE p_pattern)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION attendees.search_ids(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION attendees.search_ids(text) TO app_user;
--> statement-breakpoint
CREATE FUNCTION orders.search_ids(p_pattern text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.id FROM orders.orders o
  WHERE o.org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)
    AND (o.buyer_name ILIKE p_pattern OR o.buyer_email ILIKE p_pattern)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orders.search_ids(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orders.search_ids(text) TO app_user;
-- hand-written: end
