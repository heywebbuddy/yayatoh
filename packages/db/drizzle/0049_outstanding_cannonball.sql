-- M1.3f: tenant status (suspend / reactivate / terminate) with its history, signup codes managed
-- from the staff console (list and revoke), and suspended orgs kept off every public read.
CREATE TABLE "tenancy"."org_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"changed_by" text NOT NULL,
	CONSTRAINT "org_status_changes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_status_changes_action_check" CHECK (action in ('suspend', 'reactivate', 'terminate')),
	CONSTRAINT "org_status_changes_from_check" CHECK (from_status in ('active', 'limited', 'suspended', 'terminated')),
	CONSTRAINT "org_status_changes_to_check" CHECK (to_status in ('active', 'limited', 'suspended', 'terminated')),
	CONSTRAINT "org_status_changes_reason_length" CHECK (length(reason) between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."org_status_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."org_status_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."signup_codes" ADD COLUMN "revoked_by" text;--> statement-breakpoint
ALTER TABLE "tenancy"."org_status_changes" ADD CONSTRAINT "org_status_changes_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_status_changes_org_id_idx" ON "tenancy"."org_status_changes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_status_changes_org_created_idx" ON "tenancy"."org_status_changes" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "org_status_changes_tenant_isolation" ON "tenancy"."org_status_changes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin
-- Signup codes (M1.3f): staff list and revoke them from apps/admin. platform_reader still has no
-- privileges on the table; these functions return allowlisted columns (never the hash).
CREATE FUNCTION platform.list_signup_codes(p_limit integer)
RETURNS TABLE (
  id uuid, max_uses integer, uses integer, expires_at timestamptz, revoked_at timestamptz,
  revoked_by text, note text, created_by text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT c.id, c.max_uses, c.uses, c.expires_at, c.revoked_at, c.revoked_by, c.note, c.created_by, c.created_at
  FROM platform.signup_codes c
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT least(greatest(p_limit, 1), 500)
$$;
--> statement-breakpoint
-- Revoke one code (idempotent: an already revoked code keeps its first revocation). True when
-- this call revoked it.
CREATE FUNCTION platform.revoke_signup_code(p_id uuid, p_by text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH revoked AS (
    UPDATE platform.signup_codes c SET revoked_at = now(), revoked_by = left(p_by, 200)
    WHERE c.id = p_id AND c.revoked_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM revoked)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.list_signup_codes(integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.revoke_signup_code(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.list_signup_codes(integer) TO platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.revoke_signup_code(uuid, text) TO platform_reader;--> statement-breakpoint
-- Door scanning keeps working while an org is suspended (existing tickets stay valid; pending the
-- owner, docs/specs/M1.3/spec.md M1.3f). Terminated orgs' devices resolve to nothing.
CREATE OR REPLACE FUNCTION checkin.device_by_token(p_token_hash text)
RETURNS TABLE (org_id uuid, device_id uuid, wipe_requested boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT d.org_id, d.id, d.wipe_requested_at IS NOT NULL
  FROM checkin.devices d
  JOIN tenancy.organizations o ON o.id = d.org_id AND o.status IN ('active', 'limited', 'suspended')
  WHERE d.token_hash = p_token_hash AND d.revoked_at IS NULL
$$;
--> statement-breakpoint
-- Checkout on a page opened before the org was suspended: tells the buyer why (a published
-- event of a suspended or terminated org), nothing else.
CREATE FUNCTION events.org_unavailable_for_event(p_slug text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM events.events e
    JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('suspended', 'terminated')
    WHERE e.slug = lower(p_slug) AND e.status IN ('published', 'postponed')
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION events.org_unavailable_for_event(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.org_unavailable_for_event(text) TO app_user;--> statement-breakpoint
-- Marketplace reads (M1.11) also require an active or limited org, so a suspension takes the
-- listings off at once, before the projector drops the rows (org.status_changed@1).
CREATE OR REPLACE FUNCTION marketplace.search_listings(
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
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
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
CREATE OR REPLACE FUNCTION marketplace.listing_cities(p_now timestamptz)
RETURNS TABLE (city text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT l.city FROM marketplace.public_listings l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.on_marketplace AND l.ends_at > p_now AND l.city IS NOT NULL AND l.city <> ''
  ORDER BY 1 LIMIT 200
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION marketplace.listing_by_slug(p_slug text)
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
  FROM marketplace.public_listings l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.slug = lower(p_slug)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION marketplace.sitemap_listings(p_host text)
RETURNS TABLE (slug text, org_slug text, source_updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.slug, l.org_slug, l.source_updated_at FROM marketplace.public_listings l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.canonical_host IS NOT DISTINCT FROM lower(p_host)
  ORDER BY l.starts_at DESC, l.slug LIMIT 50000
$$;
-- hand-written: end
