ALTER TABLE "events"."events" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "events"."events" ADD CONSTRAINT "events_brand_color_check" CHECK (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."events" VALIDATE CONSTRAINT "events_brand_color_check";--> statement-breakpoint
-- Per-event branding (agreement §3): the event's accent colour for its public page, under the
-- same visibility rule as events.public_event_v2 (null: the org's brand kit applies).
CREATE FUNCTION events.public_event_brand_color(p_slug text, p_include_private boolean)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.brand_color
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id
  WHERE e.slug = lower(p_slug)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
    AND (e.visibility IN ('public', 'unlisted') OR (p_include_private AND e.status IN ('published', 'postponed')))
    AND o.status IN ('active', 'limited')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_event_brand_color(text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_event_brand_color(text, boolean) TO app_user;
