CREATE TABLE "marketplace"."listing_moderation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"hidden" boolean NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "listing_moderation_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "listing_moderation_reason_check" CHECK (length(reason) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "marketplace"."listing_moderation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketplace"."listing_moderation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ADD COLUMN "popularity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "listing_moderation_org_id_idx" ON "marketplace"."listing_moderation" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_moderation_org_event_key" ON "marketplace"."listing_moderation" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "listing_moderation_org_id_hidden_idx" ON "marketplace"."listing_moderation" USING btree ("org_id","hidden");--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ADD CONSTRAINT "public_listings_geo_check" CHECK ((latitude is null) = (longitude is null) and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))) NOT VALID;--> statement-breakpoint
-- hand-written: begin (validate the CHECK added NOT VALID on an existing table)
ALTER TABLE "marketplace"."public_listings" VALIDATE CONSTRAINT "public_listings_geo_check";
-- hand-written: end
--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ADD CONSTRAINT "public_listings_popularity_check" CHECK (popularity >= 0) NOT VALID;--> statement-breakpoint
-- hand-written: begin (validate the CHECK added NOT VALID on an existing table)
ALTER TABLE "marketplace"."public_listings" VALIDATE CONSTRAINT "public_listings_popularity_check";
-- hand-written: end
--> statement-breakpoint
CREATE POLICY "listing_moderation_tenant_isolation" ON "marketplace"."listing_moderation" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin
-- M6.14a marketplace search v2. Cross-tenant reads of the public read model only, through
-- SECURITY DEFINER functions returning allowlisted columns (never weddings, live orgs only).
--
-- Hydration of search hits and recommendations: the index only orders slugs; the rows shown come
-- from here, so a stale index entry is never shown.
CREATE FUNCTION marketplace.listings_by_slugs(p_slugs text[], p_now timestamptz)
RETURNS TABLE (
  slug text, name text, tagline text, profile text, status text, timezone text,
  starts_at timestamptz, ends_at timestamptz, venue_name text, city text, country text, currency text,
  min_price_minor bigint, max_price_minor bigint, org_slug text, org_name text, canonical_host text,
  source_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.slug, l.name, l.tagline, l.profile, l.status, l.timezone, l.starts_at, l.ends_at,
         l.venue_name, l.city, l.country, l.currency, l.min_price_minor, l.max_price_minor,
         l.org_slug, l.org_name, l.canonical_host, l.source_updated_at
  FROM marketplace.public_listings l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.slug = ANY (p_slugs[1:100]) AND l.on_marketplace AND l.profile <> 'wedding' AND l.ends_at > p_now
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.listings_by_slugs(text[], timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.listings_by_slugs(text[], timestamptz) TO app_user;
--> statement-breakpoint
-- A full reindex: marketplace rows in slug order (keyset). org_id and event_id only feed the
-- opaque document id (a hash); they never reach the index or a response.
CREATE FUNCTION marketplace.index_listings(p_after text, p_limit int, p_now timestamptz)
RETURNS TABLE (
  org_id uuid, event_id uuid, slug text, name text, tagline text, category text, profile text,
  venue_name text, city text, country text, currency text, min_price_minor bigint,
  max_price_minor bigint, org_slug text, org_name text, starts_at timestamptz, ends_at timestamptz,
  popularity int, latitude double precision, longitude double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.org_id, l.event_id, l.slug, l.name, l.tagline, l.category, l.profile, l.venue_name, l.city,
         l.country, l.currency, l.min_price_minor, l.max_price_minor, l.org_slug, l.org_name,
         l.starts_at, l.ends_at, l.popularity, l.latitude, l.longitude
  FROM marketplace.public_listings l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.on_marketplace AND l.profile <> 'wedding' AND l.ends_at > p_now AND l.slug > coalesce(p_after, '')
  ORDER BY l.slug
  LIMIT least(greatest(p_limit, 1), 1000)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.index_listings(text, int, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.index_listings(text, int, timestamptz) TO app_user;
--> statement-breakpoint
-- The "near" options: each city's mean public location over its upcoming marketplace listings.
CREATE FUNCTION marketplace.listing_city_centers(p_now timestamptz)
RETURNS TABLE (city text, lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT min(l.city), avg(l.latitude), avg(l.longitude)
  FROM marketplace.public_listings l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.on_marketplace AND l.profile <> 'wedding' AND l.ends_at > p_now
    AND l.city IS NOT NULL AND l.city <> '' AND l.latitude IS NOT NULL
  GROUP BY lower(l.city)
  ORDER BY 1 LIMIT 200
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.listing_city_centers(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.listing_city_centers(timestamptz) TO app_user;
-- hand-written: end
