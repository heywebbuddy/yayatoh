-- Security-definer functions, privileges and reference data for the tenancy kernel (M0.6).
-- Functions are owned by the migrator (BYPASSRLS) and return allowlisted columns only.

-- Slug → org for routing. Returns id and status only.
CREATE FUNCTION tenancy.resolve_org_slug(p_slug text)
RETURNS TABLE (org_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.id, o.status FROM tenancy.organizations o WHERE o.slug = lower(p_slug)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.resolve_org_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.resolve_org_slug(text) TO app_user;
--> statement-breakpoint

-- Orgs a user belongs to (org switcher). Returns allowlisted columns only.
CREATE FUNCTION tenancy.user_memberships(p_user uuid)
RETURNS TABLE (org_id uuid, slug text, name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.id, o.slug, o.name, m.role
  FROM tenancy.memberships m JOIN tenancy.organizations o ON o.id = m.org_id
  WHERE m.user_id = p_user AND o.status <> 'terminated'
  ORDER BY o.name
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.user_memberships(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.user_memberships(uuid) TO app_user;
--> statement-breakpoint

-- Outbox relay (ADR 0008). Stamps a gap-free, global log_seq in commit-visible order.
-- The transaction-level lock makes stamping single-writer even if two relays run.
CREATE FUNCTION platform.relay_stamp(batch_size integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  base bigint;
  stamped integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('platform.relay_stamp'));
  SELECT coalesce(max(log_seq), 0) INTO base FROM platform.domain_events;
  WITH pending AS (
    SELECT p.id, row_number() OVER (ORDER BY p.id) AS rn
    FROM (
      SELECT id FROM platform.domain_events WHERE log_seq IS NULL ORDER BY id LIMIT batch_size
    ) p
  )
  UPDATE platform.domain_events e SET log_seq = base + pending.rn
  FROM pending WHERE e.id = pending.id;
  GET DIAGNOSTICS stamped = ROW_COUNT;
  RETURN stamped;
END
$$;
--> statement-breakpoint
CREATE FUNCTION platform.relay_pending(batch_size integer)
RETURNS TABLE (id uuid, org_id uuid, type text, version integer, aggregate_type text, aggregate_id text, payload jsonb, log_seq bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.id, e.org_id, e.type, e.version, e.aggregate_type, e.aggregate_id, e.payload, e.log_seq
  FROM platform.domain_events e
  WHERE e.log_seq IS NOT NULL AND e.published_at IS NULL
  ORDER BY e.log_seq
  LIMIT batch_size
$$;
--> statement-breakpoint
CREATE FUNCTION platform.relay_mark_published(ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  n integer;
BEGIN
  UPDATE platform.domain_events SET published_at = now() WHERE id = ANY(ids) AND published_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.relay_stamp(integer), platform.relay_pending(integer), platform.relay_mark_published(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.relay_stamp(integer), platform.relay_pending(integer), platform.relay_mark_published(uuid[]) TO platform_reader;
--> statement-breakpoint
CREATE INDEX domain_events_relay_pending_idx ON platform.domain_events (log_seq) WHERE published_at IS NULL AND log_seq IS NOT NULL;
--> statement-breakpoint

-- Append-only tables: the runtime role may insert and read, never rewrite history.
REVOKE UPDATE, DELETE, TRUNCATE ON platform.audit_events, platform.domain_events, platform.processed_events FROM app_user;
--> statement-breakpoint

-- Reference data: read-only for the runtime role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON billing.plans, billing.plan_modules FROM app_user;
--> statement-breakpoint
INSERT INTO billing.plans (key, name) VALUES ('launch_standard', 'Launch standard');
--> statement-breakpoint
INSERT INTO billing.plan_modules (plan_key, module_key) VALUES
  ('launch_standard','core'),
  ('launch_standard','events'),
  ('launch_standard','ticketing'),
  ('launch_standard','orders'),
  ('launch_standard','attendees'),
  ('launch_standard','checkin'),
  ('launch_standard','seating'),
  ('launch_standard','seat_finder'),
  ('launch_standard','guests'),
  ('launch_standard','rsvp'),
  ('launch_standard','distribution'),
  ('launch_standard','access_codes'),
  ('launch_standard','marketing'),
  ('launch_standard','messaging'),
  ('launch_standard','reports'),
  ('launch_standard','whitelabel'),
  ('launch_standard','ai'),
  ('launch_standard','chat'),
  ('launch_standard','donations'),
  ('launch_standard','registration'),
  ('launch_standard','sessions'),
  ('launch_standard','speakers'),
  ('launch_standard','exhibitors'),
  ('launch_standard','sponsors'),
  ('launch_standard','badges'),
  ('launch_standard','gallery'),
  ('launch_standard','website');
