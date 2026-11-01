-- hand-written: begin
-- The home finder's "Where" list and its country / near-me search. Cross-tenant reads of the public
-- read model only, through SECURITY DEFINER functions returning allowlisted columns.
--
-- Every place with upcoming marketplace listings: city and country (ISO code) with the mean public
-- location and how many listings. A city that appears under two countries is two places.
CREATE FUNCTION marketplace.listing_places(p_now timestamptz)
RETURNS TABLE (city text, country text, lat double precision, lng double precision, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT min(l.city), min(l.country), avg(l.latitude), avg(l.longitude), count(*)
  FROM marketplace.public_listings l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.on_marketplace AND l.profile <> 'wedding' AND l.ends_at > p_now
    AND l.city IS NOT NULL AND l.city <> ''
  GROUP BY lower(l.city), coalesce(l.country, '')
  ORDER BY 2 NULLS LAST, 1 LIMIT 1000
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.listing_places(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.listing_places(timestamptz) TO app_user;
--> statement-breakpoint
-- The marketplace search with a country and a radius around a point (haversine, no extension).
-- Same filters and order as the 11-argument form it extends; a listing without a location never
-- matches a radius.
CREATE FUNCTION marketplace.search_listings(
  p_q text, p_city text, p_category text, p_from timestamptz, p_to timestamptz, p_price text,
  p_org_slug text, p_marketplace_only boolean, p_now timestamptz, p_limit int, p_offset int,
  p_country text, p_lat double precision, p_lng double precision, p_radius_km double precision
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
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE (l.on_marketplace OR (NOT p_marketplace_only AND p_org_slug IS NOT NULL))
    AND l.ends_at > p_now
    AND (p_org_slug IS NULL OR l.org_slug = p_org_slug)
    AND (p_q IS NULL OR l.name ILIKE '%' || p_q || '%' OR l.tagline ILIKE '%' || p_q || '%'
         OR l.venue_name ILIKE '%' || p_q || '%' OR l.city ILIKE '%' || p_q || '%'
         OR l.org_name ILIKE '%' || p_q || '%')
    AND (p_city IS NULL OR lower(l.city) = lower(p_city))
    AND (p_country IS NULL OR upper(l.country) = upper(p_country))
    AND (p_lat IS NULL OR p_lng IS NULL OR p_radius_km IS NULL OR (
           l.latitude IS NOT NULL AND
           12742 * asin(sqrt(least(1, power(sin(radians(l.latitude - p_lat) / 2), 2) +
             cos(radians(p_lat)) * cos(radians(l.latitude)) *
             power(sin(radians(l.longitude - p_lng) / 2), 2)))) <= p_radius_km))
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
REVOKE ALL ON FUNCTION marketplace.search_listings(
  text, text, text, timestamptz, timestamptz, text, text, boolean, timestamptz, int, int,
  text, double precision, double precision, double precision) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.search_listings(
  text, text, text, timestamptz, timestamptz, text, text, boolean, timestamptz, int, int,
  text, double precision, double precision, double precision) TO app_user;
-- hand-written: end
