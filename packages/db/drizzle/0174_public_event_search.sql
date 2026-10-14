-- hand-written: begin
-- M7.2f: the mobile apps' event search (GET /v1/public/events). Cross-tenant read of the public
-- read model only, through one SECURITY DEFINER function returning allowlisted columns: marketplace
-- rows of live orgs (D13: private and unlisted events and weddings are never in the table or here),
-- upcoming or ongoing, filtered by text, platform category, organizer, dates and distance from a
-- point. Keyset paging: soonest first by (starts_at, slug), or nearest first by (distance, slug)
-- when a point is given. A page asks for one row more than it shows (the caller's limit + 1).
CREATE FUNCTION marketplace.search_public_events(
  p_q text, p_category text, p_org_slug text, p_from timestamptz, p_to timestamptz,
  p_lat double precision, p_lng double precision, p_radius_km double precision,
  p_now timestamptz, p_after_at timestamptz, p_after_distance double precision, p_after_slug text,
  p_limit int
)
RETURNS TABLE (
  slug text, name text, tagline text, profile text, status text, timezone text,
  starts_at timestamptz, ends_at timestamptz, venue_name text, city text, country text, currency text,
  min_price_minor bigint, max_price_minor bigint, org_slug text, org_name text, canonical_host text,
  source_updated_at timestamptz, category text, distance_km double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH c AS (
    SELECT l.slug, l.name, l.tagline, l.profile, l.status, l.timezone, l.starts_at, l.ends_at,
           l.venue_name, l.city, l.country, l.currency, l.min_price_minor, l.max_price_minor,
           l.org_slug, l.org_name, l.canonical_host, l.source_updated_at, l.category,
           CASE WHEN p_lat IS NOT NULL AND l.latitude IS NOT NULL THEN
             6371.0088 * 2 * asin(least(1.0, sqrt(
               power(sin(radians(l.latitude - p_lat) / 2), 2)
               + cos(radians(p_lat)) * cos(radians(l.latitude)) * power(sin(radians(l.longitude - p_lng) / 2), 2)
             )))
           END AS dist
    FROM marketplace.public_listings l
    JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
    WHERE l.on_marketplace AND l.profile <> 'wedding' AND l.ends_at > p_now
      AND (p_org_slug IS NULL OR l.org_slug = p_org_slug)
      AND (p_category IS NULL OR l.category = p_category)
      AND (p_q IS NULL OR l.name ILIKE '%' || p_q || '%' OR l.tagline ILIKE '%' || p_q || '%'
           OR l.venue_name ILIKE '%' || p_q || '%' OR l.city ILIKE '%' || p_q || '%'
           OR l.org_name ILIKE '%' || p_q || '%')
      AND (p_from IS NULL OR l.ends_at >= p_from)
      AND (p_to IS NULL OR l.starts_at < p_to)
  )
  SELECT c.slug, c.name, c.tagline, c.profile, c.status, c.timezone, c.starts_at, c.ends_at,
         c.venue_name, c.city, c.country, c.currency, c.min_price_minor, c.max_price_minor,
         c.org_slug, c.org_name, c.canonical_host, c.source_updated_at, c.category, c.dist
  FROM c
  WHERE (p_lat IS NULL OR c.dist <= p_radius_km)
    AND (CASE
           WHEN p_after_slug IS NULL THEN true
           WHEN p_lat IS NOT NULL THEN (c.dist, c.slug) > (p_after_distance, p_after_slug)
           ELSE (c.starts_at, c.slug) > (p_after_at, p_after_slug)
         END)
  ORDER BY CASE WHEN p_lat IS NOT NULL THEN c.dist END, CASE WHEN p_lat IS NULL THEN c.starts_at END, c.slug
  LIMIT least(greatest(p_limit, 1), 101)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.search_public_events(text, text, text, timestamptz, timestamptz, double precision, double precision, double precision, timestamptz, timestamptz, double precision, text, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.search_public_events(text, text, text, timestamptz, timestamptz, double precision, double precision, double precision, timestamptz, timestamptz, double precision, text, int) TO app_user;
-- hand-written: end
