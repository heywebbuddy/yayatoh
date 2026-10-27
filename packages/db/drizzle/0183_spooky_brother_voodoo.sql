ALTER TABLE "events"."events" ADD COLUMN "design" jsonb;--> statement-breakpoint
ALTER TABLE "events"."events" ADD CONSTRAINT "events_design_check" CHECK (design is null or jsonb_typeof(design) = 'object');--> statement-breakpoint
-- Organizer design options for the public event page (theme, heading font, hero layout and
-- video), under the same visibility rule as events.public_event_brand_color.
CREATE FUNCTION events.public_event_design(p_slug text, p_include_private boolean)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.design
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id
  WHERE e.slug = lower(p_slug)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
    AND (e.visibility IN ('public', 'unlisted') OR (p_include_private AND e.status IN ('published', 'postponed')))
    AND o.status IN ('active', 'limited')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_event_design(text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_event_design(text, boolean) TO app_user;
