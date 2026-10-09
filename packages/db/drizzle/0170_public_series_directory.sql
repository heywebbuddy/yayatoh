-- Public series directory: only series from active organizations with upcoming public events.
CREATE FUNCTION events.public_series_directory(p_now timestamptz)
RETURNS TABLE (slug text, name text, description text, organizer_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.slug, s.name, s.description, o.name
  FROM events.series s
  JOIN tenancy.organizations o ON o.id = s.org_id AND o.status IN ('active', 'limited')
  WHERE EXISTS (
    SELECT 1
    FROM events.series_events se
    JOIN events.events e ON e.org_id = se.org_id AND e.id = se.event_id
    WHERE se.org_id = s.org_id AND se.series_id = s.id
      AND e.status IN ('published', 'postponed')
      AND e.visibility = 'public'
      AND e.ends_at >= p_now
  )
  ORDER BY s.name, s.slug
  LIMIT 500
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_series_directory(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_series_directory(timestamptz) TO app_user;
