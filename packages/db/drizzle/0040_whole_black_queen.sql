CREATE SCHEMA "marketplace";
--> statement-breakpoint
CREATE TABLE "marketplace"."legacy_redirects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"host" text NOT NULL,
	"source" text NOT NULL,
	"match" text DEFAULT 'exact' NOT NULL,
	"target" text NOT NULL,
	"status" integer DEFAULT 308 NOT NULL,
	"hits" bigint DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	CONSTRAINT "legacy_redirects_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "legacy_redirects_match_check" CHECK (match in ('exact', 'prefix')),
	CONSTRAINT "legacy_redirects_status_check" CHECK (status in (301, 302, 307, 308)),
	CONSTRAINT "legacy_redirects_source_check" CHECK (source ~ '^/' and length(source) <= 2000),
	CONSTRAINT "legacy_redirects_target_check" CHECK (target ~ '^(/|https://)' and length(target) <= 2000)
);
--> statement-breakpoint
ALTER TABLE "marketplace"."legacy_redirects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketplace"."legacy_redirects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketplace"."public_listings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"profile" text NOT NULL,
	"status" text NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"venue_name" text,
	"city" text,
	"country" text,
	"currency" text NOT NULL,
	"min_price_minor" bigint,
	"max_price_minor" bigint,
	"org_slug" text NOT NULL,
	"org_name" text NOT NULL,
	"on_marketplace" boolean DEFAULT false NOT NULL,
	"canonical_host" text,
	"published_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "public_listings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "public_listings_status_check" CHECK (status in ('published', 'postponed')),
	CONSTRAINT "public_listings_price_check" CHECK (min_price_minor is null or min_price_minor <= max_price_minor)
);
--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketplace"."site_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"list_on_marketplace" boolean DEFAULT false NOT NULL,
	"tenant_site" boolean DEFAULT false NOT NULL,
	"embed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "site_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "site_settings_embed_origins_check" CHECK (cardinality(embed_origins) <= 10)
);
--> statement-breakpoint
ALTER TABLE "marketplace"."site_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketplace"."site_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "legacy_redirects_org_id_idx" ON "marketplace"."legacy_redirects" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_redirects_host_source_key" ON "marketplace"."legacy_redirects" USING btree ("host","source");--> statement-breakpoint
CREATE INDEX "public_listings_org_id_idx" ON "marketplace"."public_listings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_listings_org_event_key" ON "marketplace"."public_listings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_listings_slug_key" ON "marketplace"."public_listings" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "public_listings_org_id_starts_at_idx" ON "marketplace"."public_listings" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "public_listings_marketplace_starts_at_idx" ON "marketplace"."public_listings" USING btree ("starts_at") WHERE on_marketplace;--> statement-breakpoint
CREATE INDEX "site_settings_org_id_idx" ON "marketplace"."site_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_settings_org_key" ON "marketplace"."site_settings" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "legacy_redirects_tenant_isolation" ON "marketplace"."legacy_redirects" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "public_listings_tenant_isolation" ON "marketplace"."public_listings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "site_settings_tenant_isolation" ON "marketplace"."site_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M1.11 marketplace. Foreign keys down the tiers (modules never import each other's schema).
ALTER TABLE marketplace.public_listings
  ADD CONSTRAINT public_listings_event_fk FOREIGN KEY (org_id, event_id)
  REFERENCES events.events (org_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE marketplace.public_listings
  ADD CONSTRAINT public_listings_org_fk FOREIGN KEY (org_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE marketplace.site_settings
  ADD CONSTRAINT site_settings_org_fk FOREIGN KEY (org_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE marketplace.legacy_redirects
  ADD CONSTRAINT legacy_redirects_org_fk FOREIGN KEY (org_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE;
--> statement-breakpoint
-- Marketplace search (cross-tenant, roadmap §3.3): allowlisted columns of upcoming and ongoing
-- listings. p_q arrives with LIKE wildcards escaped. p_marketplace_only = false only together
-- with p_org_slug (an organizer's own page lists its events whether enrolled or not).
CREATE FUNCTION marketplace.search_listings(
  p_q text, p_city text, p_category text, p_from timestamptz, p_to timestamptz, p_price text,
  p_org_slug text, p_marketplace_only boolean, p_now timestamptz, p_limit int, p_offset int
)
RETURNS TABLE (
  slug text, name text, tagline text, profile text, status text, timezone text,
  starts_at timestamptz, ends_at timestamptz, venue_name text, city text, country text, currency text,
  min_price_minor bigint, max_price_minor bigint, org_slug text, org_name text, canonical_host text,
  source_updated_at timestamptz, total bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.slug, l.name, l.tagline, l.profile, l.status, l.timezone, l.starts_at, l.ends_at,
         l.venue_name, l.city, l.country, l.currency, l.min_price_minor, l.max_price_minor,
         l.org_slug, l.org_name, l.canonical_host, l.source_updated_at, count(*) OVER ()
  FROM marketplace.public_listings l
  WHERE (l.on_marketplace OR (NOT p_marketplace_only AND p_org_slug IS NOT NULL))
    AND l.ends_at > p_now
    AND (p_org_slug IS NULL OR l.org_slug = p_org_slug)
    AND (p_q IS NULL OR l.name ILIKE '%' || p_q || '%' OR l.tagline ILIKE '%' || p_q || '%'
         OR l.venue_name ILIKE '%' || p_q || '%' OR l.city ILIKE '%' || p_q || '%'
         OR l.org_name ILIKE '%' || p_q || '%')
    AND (p_city IS NULL OR lower(l.city) = lower(p_city))
    AND (p_category IS NULL OR l.profile = p_category)
    AND (p_from IS NULL OR l.ends_at >= p_from)
    AND (p_to IS NULL OR l.starts_at < p_to)
    AND (p_price IS NULL
         OR (p_price = 'free' AND l.max_price_minor = 0)
         OR (p_price = 'paid' AND l.max_price_minor > 0))
  ORDER BY l.starts_at, l.slug
  LIMIT least(greatest(p_limit, 1), 100) OFFSET greatest(p_offset, 0)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.search_listings(text, text, text, timestamptz, timestamptz, text, text, boolean, timestamptz, int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.search_listings(text, text, text, timestamptz, timestamptz, text, text, boolean, timestamptz, int, int) TO app_user;
--> statement-breakpoint
CREATE FUNCTION marketplace.listing_cities(p_now timestamptz)
RETURNS TABLE (city text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT l.city FROM marketplace.public_listings l
  WHERE l.on_marketplace AND l.ends_at > p_now AND l.city IS NOT NULL AND l.city <> ''
  ORDER BY 1 LIMIT 200
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.listing_cities(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.listing_cities(timestamptz) TO app_user;
--> statement-breakpoint
-- One listing by event slug (canonical URL, tenant-host ownership check). org_id is returned
-- for server-side use only; the serializer does not let it out.
CREATE FUNCTION marketplace.listing_by_slug(p_slug text)
RETURNS TABLE (
  org_id uuid, slug text, name text, tagline text, profile text, status text, timezone text,
  starts_at timestamptz, ends_at timestamptz, venue_name text, city text, country text, currency text,
  min_price_minor bigint, max_price_minor bigint, org_slug text, org_name text, canonical_host text,
  source_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.org_id, l.slug, l.name, l.tagline, l.profile, l.status, l.timezone, l.starts_at, l.ends_at,
         l.venue_name, l.city, l.country, l.currency, l.min_price_minor, l.max_price_minor,
         l.org_slug, l.org_name, l.canonical_host, l.source_updated_at
  FROM marketplace.public_listings l WHERE l.slug = lower(p_slug)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.listing_by_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.listing_by_slug(text) TO app_user;
--> statement-breakpoint
-- Sitemap entries for one canonical host (NULL = the marketplace apex).
CREATE FUNCTION marketplace.sitemap_listings(p_host text)
RETURNS TABLE (slug text, org_slug text, source_updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.slug, l.org_slug, l.source_updated_at FROM marketplace.public_listings l
  WHERE l.canonical_host IS NOT DISTINCT FROM lower(p_host)
  ORDER BY l.starts_at DESC, l.slug LIMIT 50000
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.sitemap_listings(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.sitemap_listings(text) TO app_user;
--> statement-breakpoint
-- Legacy redirects (roadmap §7.7): the exact host beats '*', an exact source beats the longest
-- prefix on a segment boundary. Counts the hit. Returns nothing else.
CREATE FUNCTION marketplace.match_redirect(p_host text, p_path text)
RETURNS TABLE (source text, match text, target text, status int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  r marketplace.legacy_redirects%ROWTYPE;
BEGIN
  SELECT * INTO r FROM marketplace.legacy_redirects l
  WHERE l.host IN (lower(p_host), '*')
    AND ((l.match = 'exact' AND l.source = p_path)
      OR (l.match = 'prefix' AND (p_path = l.source
          OR left(p_path, length(rtrim(l.source, '/')) + 1) = rtrim(l.source, '/') || '/')))
  ORDER BY (l.host <> '*') DESC, (l.match = 'exact') DESC, length(l.source) DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE marketplace.legacy_redirects SET hits = hits + 1, last_hit_at = now() WHERE id = r.id;
  RETURN QUERY SELECT r.source, r.match, r.target, r.status;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.match_redirect(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.match_redirect(text, text) TO app_user;
-- hand-written: end
