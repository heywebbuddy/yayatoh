CREATE SCHEMA "templates";
--> statement-breakpoint
CREATE TABLE "events"."occurrences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "occurrences_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "occurrences_time_order_check" CHECK (ends_at > starts_at),
	CONSTRAINT "occurrences_capacity_check" CHECK (capacity is null or capacity >= 1),
	CONSTRAINT "occurrences_status_check" CHECK (status in ('scheduled', 'cancelled')),
	CONSTRAINT "occurrences_cancelled_check" CHECK ((status = 'cancelled') = (cancelled_at is not null))
);
--> statement-breakpoint
ALTER TABLE "events"."occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."occurrences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "series_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "series_slug_format_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
	CONSTRAINT "series_name_length_check" CHECK (length(name) between 2 and 160)
);
--> statement-breakpoint
ALTER TABLE "events"."series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."series_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"series_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "series_events_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "events"."series_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."series_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "templates"."event_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"profile" text NOT NULL,
	"source_event_id" uuid,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	CONSTRAINT "event_templates_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_templates_name_length_check" CHECK (length(name) between 2 and 120)
);
--> statement-breakpoint
ALTER TABLE "templates"."event_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates"."event_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."scans" DROP CONSTRAINT "scans_result_check";--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "occurrence_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "events"."occurrences" ADD CONSTRAINT "occurrences_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."series_events" ADD CONSTRAINT "series_events_series_fk" FOREIGN KEY ("org_id","series_id") REFERENCES "events"."series"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."series_events" ADD CONSTRAINT "series_events_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "occurrences_org_id_idx" ON "events"."occurrences" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "occurrences_org_event_starts_idx" ON "events"."occurrences" USING btree ("org_id","event_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_org_event_starts_key" ON "events"."occurrences" USING btree ("org_id","event_id","starts_at") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "series_org_id_idx" ON "events"."series" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "series_slug_key" ON "events"."series" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "series_org_name_idx" ON "events"."series" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "series_events_org_id_idx" ON "events"."series_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "series_events_org_event_key" ON "events"."series_events" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "series_events_org_series_idx" ON "events"."series_events" USING btree ("org_id","series_id");--> statement-breakpoint
CREATE INDEX "event_templates_org_id_idx" ON "templates"."event_templates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_templates_org_name_key" ON "templates"."event_templates" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "orders_org_occurrence_status_idx" ON "orders"."orders" USING btree ("org_id","occurrence_id","status") WHERE occurrence_id is not null;--> statement-breakpoint
CREATE INDEX "tickets_org_occurrence_idx" ON "ticketing"."tickets" USING btree ("org_id","occurrence_id") WHERE occurrence_id is not null;--> statement-breakpoint
-- hand-written: begin (existing table: NOT VALID + VALIDATE keeps the lock short; every row already satisfies it)
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_result_check" CHECK (result in ('admitted', 'duplicate', 'invalid', 'void', 'wrong_event', 'not_today', 'outside_window', 'wrong_date', 'duplicate_offline', 'superseded', 'provisional', 'granted', 'no_access')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_result_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "occurrences_tenant_isolation" ON "events"."occurrences" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "series_tenant_isolation" ON "events"."series" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "series_events_tenant_isolation" ON "events"."series_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_templates_tenant_isolation" ON "templates"."event_templates" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (ticketing 3 / orders 4 → events 2), so modules never import each
-- other's schema. New nullable columns on existing tables: NOT VALID + VALIDATE (short locks).
ALTER TABLE "ticketing"."tickets" ADD CONSTRAINT "tickets_occurrence_fk" FOREIGN KEY ("org_id","occurrence_id") REFERENCES "events"."occurrences"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" VALIDATE CONSTRAINT "tickets_occurrence_fk";--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_occurrence_fk" FOREIGN KEY ("org_id","occurrence_id") REFERENCES "events"."occurrences"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_occurrence_fk";--> statement-breakpoint
-- Public dates of an event (M1.4b), by slug: only for events the public page shows (same rules as
-- events.public_event). Capacity numbers never leave; only whether the date is sold out
-- (live tickets for the date + tickets in orders still holding stock).
CREATE FUNCTION events.public_occurrences(p_slug text)
RETURNS TABLE (id uuid, starts_at timestamptz, ends_at timestamptz, status text, sold_out boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT oc.id, oc.starts_at, oc.ends_at, oc.status,
         oc.capacity IS NOT NULL AND (
           (SELECT count(*) FROM ticketing.tickets t
             WHERE t.org_id = oc.org_id AND t.occurrence_id = oc.id AND t.status = 'active')
           + (SELECT coalesce(sum(i.quantity), 0) FROM orders.orders od
               JOIN orders.order_items i ON i.org_id = od.org_id AND i.order_id = od.id
             WHERE od.org_id = oc.org_id AND od.occurrence_id = oc.id
               AND od.status IN ('reserved', 'awaiting_payment', 'payment_failed'))
         ) >= oc.capacity
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  JOIN events.occurrences oc ON oc.org_id = e.org_id AND oc.event_id = e.id
  WHERE e.slug = lower(p_slug)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
    AND e.visibility IN ('public', 'unlisted')
  ORDER BY oc.starts_at
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_occurrences(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_occurrences(text) TO app_user;--> statement-breakpoint
-- Public series page (M1.4b): a series of an active org, allowlisted columns.
CREATE FUNCTION events.public_series(p_slug text)
RETURNS TABLE (slug text, name text, description text, organizer_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.slug, s.name, s.description, o.name
  FROM events.series s JOIN tenancy.organizations o ON o.id = s.org_id
  WHERE s.slug = lower(p_slug) AND o.status IN ('active', 'limited')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_series(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_series(text) TO app_user;--> statement-breakpoint
-- Its upcoming events: published or postponed, public only (unlisted events are not listed).
CREATE FUNCTION events.public_series_events(p_slug text, p_now timestamptz)
RETURNS TABLE (
  slug text, name text, timezone text, starts_at timestamptz, ends_at timestamptz,
  venue_name text, city text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.slug, e.name, e.timezone, e.starts_at, e.ends_at, e.venue_name, e.city
  FROM events.series s
  JOIN tenancy.organizations o ON o.id = s.org_id AND o.status IN ('active', 'limited')
  JOIN events.series_events se ON se.org_id = s.org_id AND se.series_id = s.id
  JOIN events.events e ON e.org_id = se.org_id AND e.id = se.event_id
  WHERE s.slug = lower(p_slug)
    AND e.status IN ('published', 'postponed')
    AND e.visibility = 'public'
    AND e.ends_at >= p_now
  ORDER BY e.starts_at, e.slug
  LIMIT 200
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_series_events(text, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_series_events(text, timestamptz) TO app_user;--> statement-breakpoint
-- Which dates each public pass sells for (M1.4b), same filters as ticketing.public_ticket_types_v2.
CREATE FUNCTION ticketing.public_ticket_type_occurrences(p_event_slug text)
RETURNS TABLE (id uuid, occurrence_ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.id, t.occurrence_ids
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  JOIN ticketing.ticket_types t ON t.org_id = e.org_id AND t.event_id = e.id
  WHERE e.slug = lower(p_event_slug)
    AND e.status = 'published'
    AND e.visibility IN ('public', 'unlisted')
    AND t.visibility = 'public'
    AND t.archived_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION ticketing.public_ticket_type_occurrences(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.public_ticket_type_occurrences(text) TO app_user;
-- hand-written: end
