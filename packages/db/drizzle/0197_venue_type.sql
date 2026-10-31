ALTER TABLE "venues"."venues" ADD COLUMN "venue_type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "venues"."venues" ADD CONSTRAINT "venues_venue_type_check" CHECK (venue_type in ('lounge', 'ballroom', 'conference_centre', 'outdoor', 'restaurant', 'hotel', 'other'));--> statement-breakpoint
-- The public venue page and the directory also return the venue's type (return types change, so drop and recreate).
DROP FUNCTION venues.public_venue(text);--> statement-breakpoint
CREATE FUNCTION venues.public_venue(p_slug text)
RETURNS TABLE (
  slug text, name text, address_line1 text, address_line2 text, city text, region text,
  postal_code text, country text, latitude double precision, longitude double precision,
  timezone text, capacity integer, accessibility_notes text, map_url text, organizer_name text,
  description text, contact_email text, contact_phone text, website_url text, venue_type text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.slug, v.name, v.address_line1, v.address_line2, v.city, v.region, v.postal_code,
         v.country, v.latitude, v.longitude, v.timezone, v.capacity, v.accessibility_notes,
         v.map_url, o.name, v.description, v.contact_email, v.contact_phone, v.website_url, v.venue_type
  FROM venues.venues v
  JOIN tenancy.organizations o ON o.id = v.org_id AND o.status IN ('active', 'limited')
  WHERE v.slug = lower(p_slug) AND v.directory_listed AND v.archived_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION venues.public_venue(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION venues.public_venue(text) TO app_user;--> statement-breakpoint
DROP FUNCTION venues.directory();--> statement-breakpoint
CREATE FUNCTION venues.directory()
RETURNS TABLE (slug text, name text, city text, region text, country text, capacity integer, venue_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.slug, v.name, v.city, v.region, v.country, v.capacity, v.venue_type
  FROM venues.venues v
  JOIN tenancy.organizations o ON o.id = v.org_id AND o.status IN ('active', 'limited')
  WHERE v.directory_listed AND v.archived_at IS NULL
  ORDER BY v.name
  LIMIT 500
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION venues.directory() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION venues.directory() TO app_user;
