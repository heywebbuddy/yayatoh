ALTER TABLE "seating"."event_seats" DROP CONSTRAINT "event_seats_block_check";--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" DROP CONSTRAINT "seat_assignments_prior_block_check";--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ADD COLUMN "group_label" text;--> statement-breakpoint
CREATE INDEX "event_seats_org_event_group_idx" ON "seating"."event_seats" USING btree ("org_id","event_id","group_label") WHERE group_label is not null;--> statement-breakpoint
-- hand-written: begin (existing tables: NOT VALID + VALIDATE keeps the locks short; every row already satisfies them)
-- M1.8f: seats kept back for a group ('group', named by group_label); a group member's seat remembers it.
ALTER TABLE "seating"."event_seats" ADD CONSTRAINT "event_seats_group_check" CHECK ((block_reason is distinct from 'group' or group_label is not null) and (group_label is null or length(group_label) between 1 and 40)) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" VALIDATE CONSTRAINT "event_seats_group_check";--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ADD CONSTRAINT "event_seats_block_check" CHECK ((status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in ('channel', 'ada', 'kill', 'assigned', 'group'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" VALIDATE CONSTRAINT "event_seats_block_check";--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" ADD CONSTRAINT "seat_assignments_prior_block_check" CHECK (prior_block is null or prior_block in ('channel', 'ada', 'group')) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" VALIDATE CONSTRAINT "seat_assignments_prior_block_check";
-- hand-written: end
--> statement-breakpoint
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
