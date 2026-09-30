-- Events (M1.4a): org foreign key (down the tiers, added here because modules never import each
-- other's schema) and the public read path.
ALTER TABLE events.events
  ADD CONSTRAINT events_org_fk FOREIGN KEY (org_id) REFERENCES tenancy.organizations (id) ON DELETE CASCADE;
--> statement-breakpoint
-- Public event page by slug. Drafts, archived and private events are never returned; the columns
-- are allowlisted (no org internals). Suspended or terminated orgs publish nothing.
CREATE FUNCTION events.public_event(p_slug text)
RETURNS TABLE (
  slug text, name text, tagline text, profile text, status text, timezone text,
  starts_at timestamptz, ends_at timestamptz, venue_name text, city text, currency text,
  organizer_name text, powered_by_visible boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.slug, e.name, e.tagline, e.profile, e.status, e.timezone,
         e.starts_at, e.ends_at, e.venue_name, e.city, e.currency,
         o.name, o.powered_by_visible
  FROM events.events e JOIN tenancy.organizations o ON o.id = e.org_id
  WHERE e.slug = lower(p_slug)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
    AND e.visibility IN ('public', 'unlisted')
    AND o.status IN ('active', 'limited')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_event(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_event(text) TO app_user;
