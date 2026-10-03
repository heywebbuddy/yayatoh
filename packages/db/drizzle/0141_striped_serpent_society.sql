CREATE TABLE "marketplace"."promotions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "promotions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "promotions_window_check" CHECK (ends_at > starts_at and ends_at <= starts_at + interval '30 days')
);
--> statement-breakpoint
ALTER TABLE "marketplace"."promotions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketplace"."promotions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."layout_shares" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"layout_id" uuid NOT NULL,
	"partner_org_id" uuid NOT NULL,
	CONSTRAINT "layout_shares_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "layout_shares_not_self" CHECK (partner_org_id <> org_id)
);
--> statement-breakpoint
ALTER TABLE "seating"."layout_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."layout_shares" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."shared_layout_uses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"venue_org_id" uuid NOT NULL,
	"venue_layout_id" uuid NOT NULL,
	CONSTRAINT "shared_layout_uses_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "shared_layout_uses_not_self" CHECK (venue_org_id <> org_id)
);
--> statement-breakpoint
ALTER TABLE "seating"."shared_layout_uses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."shared_layout_uses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."layout_shares" ADD CONSTRAINT "layout_shares_layout_fk" FOREIGN KEY ("org_id","layout_id") REFERENCES "seating"."layouts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotions_org_id_idx" ON "marketplace"."promotions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_org_event_key" ON "marketplace"."promotions" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "promotions_org_ends_at_idx" ON "marketplace"."promotions" USING btree ("org_id","ends_at");--> statement-breakpoint
CREATE INDEX "layout_shares_org_id_idx" ON "seating"."layout_shares" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "layout_shares_org_layout_partner_key" ON "seating"."layout_shares" USING btree ("org_id","layout_id","partner_org_id");--> statement-breakpoint
CREATE INDEX "layout_shares_org_partner_idx" ON "seating"."layout_shares" USING btree ("org_id","partner_org_id");--> statement-breakpoint
CREATE INDEX "shared_layout_uses_org_id_idx" ON "seating"."shared_layout_uses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_layout_uses_org_event_key" ON "seating"."shared_layout_uses" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "shared_layout_uses_org_venue_idx" ON "seating"."shared_layout_uses" USING btree ("org_id","venue_org_id");--> statement-breakpoint
CREATE POLICY "promotions_tenant_isolation" ON "marketplace"."promotions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "layout_shares_tenant_isolation" ON "seating"."layout_shares" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "shared_layout_uses_tenant_isolation" ON "seating"."shared_layout_uses" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.14b venues: composite and cross-module FKs.
ALTER TABLE "seating"."layout_shares" ADD CONSTRAINT "layout_shares_partner_org_fk" FOREIGN KEY ("partner_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "seating"."shared_layout_uses" ADD CONSTRAINT "shared_layout_uses_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "seating"."shared_layout_uses" ADD CONSTRAINT "shared_layout_uses_venue_layout_fk" FOREIGN KEY ("venue_org_id","venue_layout_id") REFERENCES "seating"."layouts"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "marketplace"."promotions" ADD CONSTRAINT "promotions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
-- Cross-org reads of the venue ↔ organizer sharing, bound to the caller's own tenant
-- (`app.org_id`, set by withTenant), never to a parameter naming another org. Each checks the
-- share and an active `venue_partner` relationship on every call: a revoke or a detach applies on
-- the next request. Allowlisted columns only.
--
-- The venue's partners (organizers it shares with): slug and name only.
CREATE FUNCTION tenancy.venue_partners()
RETURNS TABLE (partner_org_id uuid, slug text, name text, since timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.id, o.slug, o.name, r.updated_at
  FROM tenancy.org_relationships r
  JOIN tenancy.organizations o ON o.id = r.child_org_id
  WHERE r.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND r.kind = 'venue_partner' AND r.detached_at IS NULL
  ORDER BY o.name, o.slug
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.venue_partners() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.venue_partners() TO app_user;
--> statement-breakpoint
-- Plans venues share with the caller (an organizer): the plan's name and size, the venue's name.
CREATE FUNCTION seating.partner_shared_layouts()
RETURNS TABLE (
  layout_id uuid, name text, seat_count int, venue_org_id uuid, venue_name text, venue_slug text,
  shared_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.id, l.name, l.seat_count, v.id, v.name, v.slug, s.created_at, l.updated_at
  FROM seating.layout_shares s
  JOIN seating.layouts l ON l.org_id = s.org_id AND l.id = s.layout_id
  JOIN tenancy.organizations v ON v.id = s.org_id AND v.status IN ('active', 'limited')
  JOIN tenancy.org_relationships r
    ON r.org_id = s.org_id AND r.child_org_id = s.partner_org_id
   AND r.kind = 'venue_partner' AND r.detached_at IS NULL
  WHERE s.partner_org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  ORDER BY v.name, l.name, l.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION seating.partner_shared_layouts() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION seating.partner_shared_layouts() TO app_user;
--> statement-breakpoint
-- One shared plan's document, for the caller to copy into its own event (copy-on-use).
CREATE FUNCTION seating.partner_shared_layout_doc(p_layout_id uuid)
RETURNS TABLE (layout_id uuid, venue_org_id uuid, name text, doc jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.id, l.org_id, l.name, l.doc
  FROM seating.layout_shares s
  JOIN seating.layouts l ON l.org_id = s.org_id AND l.id = s.layout_id
  JOIN tenancy.organizations v ON v.id = s.org_id AND v.status IN ('active', 'limited')
  JOIN tenancy.org_relationships r
    ON r.org_id = s.org_id AND r.child_org_id = s.partner_org_id
   AND r.kind = 'venue_partner' AND r.detached_at IS NULL
  WHERE s.partner_org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND s.layout_id = p_layout_id
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION seating.partner_shared_layout_doc(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION seating.partner_shared_layout_doc(uuid) TO app_user;
--> statement-breakpoint
-- The caller's (a venue's) plans in use by partners' events: the plan, the organizer's name, the
-- event's name, start, time zone and status. Nothing else of the organizer's event.
CREATE FUNCTION seating.venue_layout_uses()
RETURNS TABLE (
  layout_id uuid, layout_name text, organizer_name text, event_name text,
  starts_at timestamptz, timezone text, status text, used_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.id, l.name, o.name, e.name, e.starts_at, e.timezone, e.status, u.created_at
  FROM seating.shared_layout_uses u
  JOIN seating.layouts l ON l.org_id = u.venue_org_id AND l.id = u.venue_layout_id
  JOIN events.events e ON e.org_id = u.org_id AND e.id = u.event_id
  JOIN tenancy.organizations o ON o.id = u.org_id
  JOIN tenancy.org_relationships r
    ON r.org_id = u.venue_org_id AND r.child_org_id = u.org_id
   AND r.kind = 'venue_partner' AND r.detached_at IS NULL
  WHERE u.venue_org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  ORDER BY e.starts_at, e.name, u.id
  LIMIT 500
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION seating.venue_layout_uses() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION seating.venue_layout_uses() TO app_user;
--> statement-breakpoint
-- Promoted placements in search: slugs of public marketplace listings (live orgs, never weddings,
-- not yet ended) with a promotion running at p_now. Search filters them by the visitor's query.
CREATE FUNCTION marketplace.promoted_slugs(p_now timestamptz)
RETURNS TABLE (slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.slug
  FROM marketplace.promotions p
  JOIN marketplace.public_listings l ON l.org_id = p.org_id AND l.event_id = p.event_id
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE p.ended_at IS NULL AND p.starts_at <= p_now AND p.ends_at > p_now
    AND l.on_marketplace AND l.profile <> 'wedding' AND l.ends_at > p_now
  ORDER BY p.starts_at, l.slug
  LIMIT 20
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION marketplace.promoted_slugs(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketplace.promoted_slugs(timestamptz) TO app_user;
-- hand-written: end
