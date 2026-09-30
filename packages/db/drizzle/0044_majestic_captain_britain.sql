CREATE SCHEMA "venues";
--> statement-breakpoint
CREATE TABLE "venues"."quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"event_date" date,
	"guests" integer,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"client_key" text NOT NULL,
	CONSTRAINT "quote_requests_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "quote_requests_status_check" CHECK (status in ('new', 'handled')),
	CONSTRAINT "quote_requests_guests_check" CHECK (guests is null or guests > 0)
);
--> statement-breakpoint
ALTER TABLE "venues"."quote_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venues"."quote_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "venues"."venues" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"timezone" text NOT NULL,
	"capacity" integer,
	"accessibility_notes" text,
	"map_url" text,
	"directory_listed" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "venues_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "venues_slug_format_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
	CONSTRAINT "venues_country_check" CHECK (country ~ '^[A-Z]{2}$'),
	CONSTRAINT "venues_capacity_check" CHECK (capacity is null or capacity > 0),
	CONSTRAINT "venues_geo_check" CHECK ((latitude is null) = (longitude is null) and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))),
	CONSTRAINT "venues_map_url_check" CHECK (map_url is null or map_url ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "venues"."venues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venues"."venues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."access_code_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	CONSTRAINT "access_code_attempts_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "events"."access_code_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."access_code_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."access_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"unlocks_event" boolean DEFAULT false NOT NULL,
	"ticket_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "access_codes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "access_codes_code_check" CHECK (code ~ '^[A-Z0-9_-]{4,32}$'),
	CONSTRAINT "access_codes_max_uses_check" CHECK (max_uses is null or max_uses > 0),
	CONSTRAINT "access_codes_uses_check" CHECK (uses >= 0),
	CONSTRAINT "access_codes_unlocks_check" CHECK (unlocks_event or cardinality(ticket_type_ids) > 0)
);
--> statement-breakpoint
ALTER TABLE "events"."access_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."access_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."event_announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text DEFAULT 'public' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "event_announcements_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_announcements_audience_check" CHECK (audience in ('public', 'holders'))
);
--> statement-breakpoint
ALTER TABLE "events"."event_announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_announcements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."event_private_info" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"join_url" text,
	"join_opens_minutes" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "event_private_info_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_private_info_join_url_check" CHECK (join_url is null or join_url ~ '^https://'),
	CONSTRAINT "event_private_info_join_opens_check" CHECK (join_opens_minutes between 0 and 1440)
);
--> statement-breakpoint
ALTER TABLE "events"."event_private_info" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_private_info" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."event_sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"content" jsonb NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	CONSTRAINT "event_sections_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_sections_kind_check" CHECK (kind in ('text', 'faq', 'schedule', 'location', 'links'))
);
--> statement-breakpoint
ALTER TABLE "events"."event_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_sections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."event_tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"tag_key" text NOT NULL,
	CONSTRAINT "event_tags_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_tags_length_check" CHECK (char_length(tag) between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "events"."event_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."short_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "short_links_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "short_links_kind_check" CHECK (kind in ('auto', 'vanity')),
	CONSTRAINT "short_links_code_check" CHECK (code ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$')
);
--> statement-breakpoint
ALTER TABLE "events"."short_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."short_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."events" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
ALTER TABLE "events"."events" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "events"."events" ADD COLUMN "attendance_mode" text DEFAULT 'in_person' NOT NULL;--> statement-breakpoint
ALTER TABLE "venues"."quote_requests" ADD CONSTRAINT "quote_requests_venue_fk" FOREIGN KEY ("org_id","venue_id") REFERENCES "venues"."venues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."access_code_attempts" ADD CONSTRAINT "access_code_attempts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."access_codes" ADD CONSTRAINT "access_codes_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."event_announcements" ADD CONSTRAINT "event_announcements_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."event_private_info" ADD CONSTRAINT "event_private_info_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."event_sections" ADD CONSTRAINT "event_sections_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."event_tags" ADD CONSTRAINT "event_tags_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events"."short_links" ADD CONSTRAINT "short_links_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_requests_org_id_idx" ON "venues"."quote_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "quote_requests_org_venue_created_idx" ON "venues"."quote_requests" USING btree ("org_id","venue_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_requests_org_client_created_idx" ON "venues"."quote_requests" USING btree ("org_id","client_key","created_at");--> statement-breakpoint
CREATE INDEX "venues_org_id_idx" ON "venues"."venues" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_slug_key" ON "venues"."venues" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "venues_org_id_name_idx" ON "venues"."venues" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "access_code_attempts_org_id_idx" ON "events"."access_code_attempts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "access_code_attempts_org_event_client_created_idx" ON "events"."access_code_attempts" USING btree ("org_id","event_id","client_key","created_at");--> statement-breakpoint
CREATE INDEX "access_codes_org_id_idx" ON "events"."access_codes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_codes_org_event_code_key" ON "events"."access_codes" USING btree ("org_id","event_id","code");--> statement-breakpoint
CREATE INDEX "event_announcements_org_id_idx" ON "events"."event_announcements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "event_announcements_org_event_published_idx" ON "events"."event_announcements" USING btree ("org_id","event_id","published_at");--> statement-breakpoint
CREATE INDEX "event_private_info_org_id_idx" ON "events"."event_private_info" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_private_info_org_event_key" ON "events"."event_private_info" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "event_sections_org_id_idx" ON "events"."event_sections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "event_sections_org_event_position_idx" ON "events"."event_sections" USING btree ("org_id","event_id","position");--> statement-breakpoint
CREATE INDEX "event_tags_org_id_idx" ON "events"."event_tags" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_tags_org_event_key_key" ON "events"."event_tags" USING btree ("org_id","event_id","tag_key");--> statement-breakpoint
CREATE INDEX "event_tags_org_key_idx" ON "events"."event_tags" USING btree ("org_id","tag_key");--> statement-breakpoint
CREATE INDEX "short_links_org_id_idx" ON "events"."short_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "short_links_code_key" ON "events"."short_links" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "short_links_org_event_kind_key" ON "events"."short_links" USING btree ("org_id","event_id","kind");--> statement-breakpoint
CREATE INDEX "events_org_id_venue_id_idx" ON "events"."events" USING btree ("org_id","venue_id");--> statement-breakpoint
CREATE INDEX "events_org_id_category_idx" ON "events"."events" USING btree ("org_id","category");--> statement-breakpoint
-- hand-written: begin (existing table: NOT VALID + VALIDATE keeps the lock short; every existing row passes)
ALTER TABLE "events"."events" ADD CONSTRAINT "events_category_check" CHECK (category is null or category in ('arts_culture', 'business_seminars', 'charity', 'community', 'education_classes', 'family', 'food_drink', 'health_wellness', 'music', 'nightlife', 'religion_spirituality', 'social_gatherings', 'sports_fitness', 'technology', 'travel_leisure', 'other')) NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."events" VALIDATE CONSTRAINT "events_category_check";--> statement-breakpoint
ALTER TABLE "events"."events" ADD CONSTRAINT "events_attendance_mode_check" CHECK (attendance_mode in ('in_person', 'online', 'hybrid')) NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."events" VALIDATE CONSTRAINT "events_attendance_mode_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "quote_requests_tenant_isolation" ON "venues"."quote_requests" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "venues_tenant_isolation" ON "venues"."venues" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "access_code_attempts_tenant_isolation" ON "events"."access_code_attempts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "access_codes_tenant_isolation" ON "events"."access_codes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_announcements_tenant_isolation" ON "events"."event_announcements" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_private_info_tenant_isolation" ON "events"."event_private_info" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_sections_tenant_isolation" ON "events"."event_sections" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_tags_tenant_isolation" ON "events"."event_tags" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "short_links_tenant_isolation" ON "events"."short_links" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M1.4c/d: cross-module foreign keys, public read paths, backfill)
-- venues (tier 1) → tenancy (tier 1): the org foreign key, as for events in 0006.
ALTER TABLE "venues"."venues" ADD CONSTRAINT "venues_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
-- events (tier 2) → venues (tier 1). Existing table: NOT VALID, then VALIDATE (all venue_id are null).
-- Venues are archived, never deleted, so no ON DELETE action is needed.
ALTER TABLE "events"."events" ADD CONSTRAINT "events_venue_fk" FOREIGN KEY ("org_id","venue_id") REFERENCES "venues"."venues"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."events" VALIDATE CONSTRAINT "events_venue_fk";--> statement-breakpoint
-- Public event page v2 (expand; v1 stays until nothing calls it): adds category, attendance mode,
-- the directory venue's slug and visibility. `p_include_private` is passed true only by the server
-- after an access code unlocked the event. Allowlisted columns; never private info.
CREATE FUNCTION events.public_event_v2(p_slug text, p_include_private boolean)
RETURNS TABLE (
  slug text, name text, tagline text, profile text, status text, timezone text,
  starts_at timestamptz, ends_at timestamptz, venue_name text, city text, currency text,
  organizer_name text, powered_by_visible boolean, category text, attendance_mode text,
  venue_slug text, visibility text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.slug, e.name, e.tagline, e.profile, e.status, e.timezone,
         e.starts_at, e.ends_at, e.venue_name, e.city, e.currency,
         o.name, o.powered_by_visible, e.category, e.attendance_mode,
         CASE WHEN v.directory_listed AND v.archived_at IS NULL THEN v.slug END, e.visibility
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id
  LEFT JOIN venues.venues v ON v.org_id = e.org_id AND v.id = e.venue_id
  WHERE e.slug = lower(p_slug)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
    AND (e.visibility IN ('public', 'unlisted') OR (p_include_private AND e.status IN ('published', 'postponed')))
    AND o.status IN ('active', 'limited')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_event_v2(text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_event_v2(text, boolean) TO app_user;--> statement-breakpoint
-- Public page content: slug → (org, event) under the same rule as events.public_event.
CREATE FUNCTION events.page_target(p_slug text)
RETURNS TABLE (org_id uuid, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.org_id, e.id FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  WHERE e.slug = lower(p_slug)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
    AND e.visibility IN ('public', 'unlisted')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.page_target(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.page_target(text) TO app_user;--> statement-breakpoint
-- Access codes: a live event of any visibility (the server shows a private page only after a code).
CREATE FUNCTION events.access_target(p_slug text)
RETURNS TABLE (org_id uuid, event_id uuid, visibility text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.org_id, e.id, e.visibility FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  WHERE e.slug = lower(p_slug) AND e.status IN ('published', 'postponed')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.access_target(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.access_target(text) TO app_user;--> statement-breakpoint
-- Short links: /e/{code} → slug, for events with a page (drafts and archived never resolve).
CREATE FUNCTION events.short_link_target(p_code text)
RETURNS TABLE (slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.slug FROM events.short_links s
  JOIN events.events e ON e.org_id = s.org_id AND e.id = s.event_id
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  WHERE s.code = lower(p_code)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.short_link_target(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.short_link_target(text) TO app_user;--> statement-breakpoint
-- Venue page: upcoming public (not unlisted, not private) events at a directory venue.
CREATE FUNCTION events.public_events_at_venue(p_venue_slug text)
RETURNS TABLE (slug text, name text, starts_at timestamptz, ends_at timestamptz, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.slug, e.name, e.starts_at, e.ends_at, e.timezone
  FROM venues.venues v
  JOIN tenancy.organizations o ON o.id = v.org_id AND o.status IN ('active', 'limited')
  JOIN events.events e ON e.org_id = v.org_id AND e.venue_id = v.id
  WHERE v.slug = lower(p_venue_slug) AND v.directory_listed AND v.archived_at IS NULL
    AND e.status IN ('published', 'postponed') AND e.visibility = 'public' AND e.ends_at > now()
  ORDER BY e.starts_at
  LIMIT 50
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_events_at_venue(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_events_at_venue(text) TO app_user;--> statement-breakpoint
-- Venue directory: listed, live venues of active orgs, allowlisted columns.
CREATE FUNCTION venues.directory()
RETURNS TABLE (slug text, name text, city text, region text, country text, capacity integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.slug, v.name, v.city, v.region, v.country, v.capacity
  FROM venues.venues v
  JOIN tenancy.organizations o ON o.id = v.org_id AND o.status IN ('active', 'limited')
  WHERE v.directory_listed AND v.archived_at IS NULL
  ORDER BY v.name
  LIMIT 500
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION venues.directory() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION venues.directory() TO app_user;--> statement-breakpoint
CREATE FUNCTION venues.public_venue(p_slug text)
RETURNS TABLE (
  slug text, name text, address_line1 text, address_line2 text, city text, region text,
  postal_code text, country text, latitude double precision, longitude double precision,
  timezone text, capacity integer, accessibility_notes text, map_url text, organizer_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.slug, v.name, v.address_line1, v.address_line2, v.city, v.region, v.postal_code,
         v.country, v.latitude, v.longitude, v.timezone, v.capacity, v.accessibility_notes,
         v.map_url, o.name
  FROM venues.venues v
  JOIN tenancy.organizations o ON o.id = v.org_id AND o.status IN ('active', 'limited')
  WHERE v.slug = lower(p_slug) AND v.directory_listed AND v.archived_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION venues.public_venue(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION venues.public_venue(text) TO app_user;--> statement-breakpoint
-- Quote form: venue slug → (org, venue), server-side only (the org never comes from the request).
CREATE FUNCTION venues.quote_target(p_slug text)
RETURNS TABLE (org_id uuid, venue_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.org_id, v.id FROM venues.venues v
  JOIN tenancy.organizations o ON o.id = v.org_id AND o.status = 'active'
  WHERE v.slug = lower(p_slug) AND v.directory_listed AND v.archived_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION venues.quote_target(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION venues.quote_target(text) TO app_user;--> statement-breakpoint
-- Public passes v3 (expand; v2 stays until nothing calls it): hidden passes an access code
-- unlocked (`p_unlocked`, checked by the server) and private events a code opened (`p_private_ok`).
CREATE FUNCTION ticketing.public_ticket_types_v3(p_event_slug text, p_unlocked uuid[], p_private_ok boolean)
RETURNS TABLE (
  id uuid, name text, description text, price_minor bigint, currency text, fee_mode text,
  remaining integer, sales_start_at timestamptz, sales_end_at timestamptz,
  min_per_order integer, max_per_order integer, percent_bps integer, fixed_minor bigint,
  early_price_minor bigint, early_ends_at timestamptz, is_donation boolean, access_dates jsonb,
  unlocked boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.id, t.name, t.description, t.price_minor, t.currency, t.fee_mode,
         t.quantity_total - t.quantity_sold - t.quantity_held,
         t.sales_start_at, t.sales_end_at, t.min_per_order, t.max_per_order,
         coalesce(ov.percent_bps, fs.percent_bps, 0), coalesce(ov.fixed_minor, fs.fixed_minor, 0),
         t.early_price_minor, t.early_ends_at, t.is_donation, t.access_dates,
         t.visibility <> 'public'
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  JOIN ticketing.ticket_types t ON t.org_id = e.org_id AND t.event_id = e.id
  LEFT JOIN billing.org_fee_overrides ov ON ov.org_id = e.org_id AND ov.currency = t.currency
  LEFT JOIN billing.fee_schedules fs ON fs.currency = t.currency
    AND fs.plan_key = coalesce((SELECT p.plan_key FROM billing.org_plans p WHERE p.org_id = e.org_id LIMIT 1), 'launch_standard')
  WHERE e.slug = lower(p_event_slug)
    AND e.status = 'published'
    AND (e.visibility IN ('public', 'unlisted') OR (p_private_ok AND e.visibility = 'private'))
    AND (t.visibility = 'public' OR t.id = ANY (coalesce(p_unlocked, '{}'::uuid[])))
    AND t.archived_at IS NULL
  ORDER BY t.sort_order, t.created_at
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION ticketing.public_ticket_types_v3(text, uuid[], boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.public_ticket_types_v3(text, uuid[], boolean) TO app_user;--> statement-breakpoint
-- Backfill: every existing event gets its automatic short code (7 characters of the unambiguous
-- alphabet, as `generateShortCode`); a clash (vanishingly rare) is left for the console's repair.
INSERT INTO events.short_links (org_id, event_id, code, kind)
SELECT e.org_id, e.id,
       (SELECT string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
          FROM generate_series(1, 7) WHERE e.id IS NOT NULL),
       'auto'
FROM events.events e
ON CONFLICT DO NOTHING;
-- hand-written: end
--> statement-breakpoint
-- hand-written: begin (merge of M1.4b dates with M1.4d access codes)
-- The public dates and each pass's dates honour an access code like public_event_v2 /
-- public_ticket_types_v3: a private event a code opened, and hidden passes it unlocked. The
-- one-argument M1.4b functions stay (expand); the app reads only these.
CREATE FUNCTION events.public_occurrences_v2(p_slug text, p_include_private boolean)
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
    AND (e.visibility IN ('public', 'unlisted') OR (p_include_private AND e.visibility = 'private'))
  ORDER BY oc.starts_at
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_occurrences_v2(text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_occurrences_v2(text, boolean) TO app_user;--> statement-breakpoint
CREATE FUNCTION ticketing.public_ticket_type_occurrences_v2(p_event_slug text, p_unlocked uuid[], p_private_ok boolean)
RETURNS TABLE (id uuid, occurrence_ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.id, t.occurrence_ids
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  JOIN ticketing.ticket_types t ON t.org_id = e.org_id AND t.event_id = e.id
  WHERE e.slug = lower(p_event_slug)
    AND e.status = 'published'
    AND (e.visibility IN ('public', 'unlisted') OR (p_private_ok AND e.visibility = 'private'))
    AND (t.visibility = 'public' OR t.id = ANY (coalesce(p_unlocked, '{}'::uuid[])))
    AND t.archived_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION ticketing.public_ticket_type_occurrences_v2(text, uuid[], boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.public_ticket_type_occurrences_v2(text, uuid[], boolean) TO app_user;
-- hand-written: end
