ALTER TABLE "venues"."venues" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "venues"."venues" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "venues"."venues" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "venues"."venues" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "venues"."venues" ADD CONSTRAINT "venues_website_url_check" CHECK (website_url is null or website_url ~ '^https?://');--> statement-breakpoint
-- Public venue page: description and contact details (return type changes, so drop and recreate).
DROP FUNCTION venues.public_venue(text);--> statement-breakpoint
CREATE FUNCTION venues.public_venue(p_slug text)
RETURNS TABLE (
  slug text, name text, address_line1 text, address_line2 text, city text, region text,
  postal_code text, country text, latitude double precision, longitude double precision,
  timezone text, capacity integer, accessibility_notes text, map_url text, organizer_name text,
  description text, contact_email text, contact_phone text, website_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.slug, v.name, v.address_line1, v.address_line2, v.city, v.region, v.postal_code,
         v.country, v.latitude, v.longitude, v.timezone, v.capacity, v.accessibility_notes,
         v.map_url, o.name, v.description, v.contact_email, v.contact_phone, v.website_url
  FROM venues.venues v
  JOIN tenancy.organizations o ON o.id = v.org_id AND o.status IN ('active', 'limited')
  WHERE v.slug = lower(p_slug) AND v.directory_listed AND v.archived_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION venues.public_venue(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION venues.public_venue(text) TO app_user;
