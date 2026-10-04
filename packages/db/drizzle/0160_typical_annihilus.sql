CREATE SCHEMA "agency_ops";
--> statement-breakpoint
CREATE TABLE "agency_ops"."brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"brand_color" text NOT NULL,
	"private_notes" text,
	"received_from_agency_org_id" uuid,
	"applied_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "brand_kits_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "brand_kits_name_length" CHECK (length(name) between 1 and 80),
	CONSTRAINT "brand_kits_color_check" CHECK (brand_color ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "brand_kits_private_notes_check" CHECK (private_notes is null or (received_from_agency_org_id is null and length(private_notes) <= 2000))
);
--> statement-breakpoint
ALTER TABLE "agency_ops"."brand_kits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_ops"."brand_kits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_ops"."detachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agency_org_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"initiated_by" text NOT NULL,
	"by_user_id" uuid,
	"templates_kept" integer DEFAULT 0 NOT NULL,
	"brand_kits_kept" integer DEFAULT 0 NOT NULL,
	"campaigns_kept" integer DEFAULT 0 NOT NULL,
	"staff_revoked" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "detachments_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "detachments_initiated_check" CHECK (initiated_by in ('client', 'agency'))
);
--> statement-breakpoint
ALTER TABLE "agency_ops"."detachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_ops"."detachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_ops"."fanout_targets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fanout_id" uuid NOT NULL,
	"client_org_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"client_campaign_id" uuid,
	"error_code" text,
	CONSTRAINT "fanout_targets_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "fanout_targets_status_check" CHECK (status in ('pending', 'draft', 'sent', 'needs_address', 'failed', 'detached')),
	CONSTRAINT "fanout_targets_error_check" CHECK (error_code is null or error_code ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "agency_ops"."fanout_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_ops"."fanout_targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_ops"."fanouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"heading" text NOT NULL,
	"body" text NOT NULL,
	"audience" text NOT NULL,
	"mode" text NOT NULL,
	"created_by" uuid,
	CONSTRAINT "fanouts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "fanouts_name_length" CHECK (length(name) between 1 and 120),
	CONSTRAINT "fanouts_subject_length" CHECK (length(subject) between 1 and 150),
	CONSTRAINT "fanouts_heading_length" CHECK (length(heading) between 1 and 200),
	CONSTRAINT "fanouts_body_length" CHECK (length(body) between 1 and 5000),
	CONSTRAINT "fanouts_audience_check" CHECK (audience in ('everyone', 'attendees')),
	CONSTRAINT "fanouts_mode_check" CHECK (mode in ('draft', 'send'))
);
--> statement-breakpoint
ALTER TABLE "agency_ops"."fanouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_ops"."fanouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_ops"."publications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"client_org_id" uuid NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"published_by" uuid,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "publications_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "publications_kind_check" CHECK (kind in ('template', 'brand_kit')),
	CONSTRAINT "publications_status_check" CHECK (status in ('published', 'failed', 'detached')),
	CONSTRAINT "publications_error_check" CHECK (error_code is null or error_code ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "agency_ops"."publications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_ops"."publications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_ops"."received_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"local_id" uuid NOT NULL,
	"agency_org_id" uuid NOT NULL,
	"source_id" uuid,
	"detached_at" timestamp with time zone,
	CONSTRAINT "received_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "received_items_kind_check" CHECK (kind in ('template', 'brand_kit', 'campaign')),
	CONSTRAINT "received_items_detached_check" CHECK (detached_at is null or source_id is null)
);
--> statement-breakpoint
ALTER TABLE "agency_ops"."received_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_ops"."received_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_ops"."template_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"template_id" uuid NOT NULL,
	"private_notes" text,
	"private_parts" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "template_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "template_settings_notes_length" CHECK (private_notes is null or length(private_notes) <= 2000),
	CONSTRAINT "template_settings_parts_check" CHECK (private_parts <@ array['questions', 'seating']::text[])
);
--> statement-breakpoint
ALTER TABLE "agency_ops"."template_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_ops"."template_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."agency_staff_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grant_id" uuid NOT NULL,
	"agency_org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"event_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "agency_staff_grants_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "agency_staff_grants_kind_check" CHECK (kind in ('team', 'day_of')),
	CONSTRAINT "agency_staff_grants_role_check" CHECK (role in ('manager', 'marketing', 'viewer')),
	CONSTRAINT "agency_staff_grants_window_check" CHECK ((kind = 'team' and event_id is null and starts_at is null and ends_at is null) or (kind = 'day_of' and event_id is not null and starts_at is not null and ends_at > starts_at and ends_at - starts_at <= interval '72 hours')),
	CONSTRAINT "agency_staff_grants_revoked_check" CHECK ((revoked_at is null) = (revoked_by is null))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."agency_staff_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."agency_staff_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."flags" DROP CONSTRAINT "flags_key_check";--> statement-breakpoint
ALTER TABLE "agency_ops"."fanout_targets" ADD CONSTRAINT "fanout_targets_fanout_fk" FOREIGN KEY ("org_id","fanout_id") REFERENCES "agency_ops"."fanouts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."agency_staff_grants" ADD CONSTRAINT "agency_staff_grants_grant_fk" FOREIGN KEY ("org_id","grant_id") REFERENCES "tenancy"."org_access_grants"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."agency_staff_grants" ADD CONSTRAINT "agency_staff_grants_agency_fk" FOREIGN KEY ("agency_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_kits_org_id_idx" ON "agency_ops"."brand_kits" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_org_name_key" ON "agency_ops"."brand_kits" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "detachments_org_id_idx" ON "agency_ops"."detachments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "detachments_org_created_idx" ON "agency_ops"."detachments" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "fanout_targets_org_id_idx" ON "agency_ops"."fanout_targets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fanout_targets_org_fanout_client_key" ON "agency_ops"."fanout_targets" USING btree ("org_id","fanout_id","client_org_id");--> statement-breakpoint
CREATE INDEX "fanout_targets_org_client_idx" ON "agency_ops"."fanout_targets" USING btree ("org_id","client_org_id");--> statement-breakpoint
CREATE INDEX "fanouts_org_id_idx" ON "agency_ops"."fanouts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "fanouts_org_created_idx" ON "agency_ops"."fanouts" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "publications_org_id_idx" ON "agency_ops"."publications" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_org_kind_source_client_key" ON "agency_ops"."publications" USING btree ("org_id","kind","source_id","client_org_id");--> statement-breakpoint
CREATE INDEX "publications_org_client_idx" ON "agency_ops"."publications" USING btree ("org_id","client_org_id");--> statement-breakpoint
CREATE INDEX "received_items_org_id_idx" ON "agency_ops"."received_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "received_items_org_kind_local_key" ON "agency_ops"."received_items" USING btree ("org_id","kind","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "received_items_org_agency_source_key" ON "agency_ops"."received_items" USING btree ("org_id","agency_org_id","kind","source_id") WHERE source_id is not null;--> statement-breakpoint
CREATE INDEX "received_items_org_agency_idx" ON "agency_ops"."received_items" USING btree ("org_id","agency_org_id");--> statement-breakpoint
CREATE INDEX "template_settings_org_id_idx" ON "agency_ops"."template_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_settings_org_template_key" ON "agency_ops"."template_settings" USING btree ("org_id","template_id");--> statement-breakpoint
CREATE INDEX "agency_staff_grants_org_id_idx" ON "tenancy"."agency_staff_grants" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_staff_grants_team_live_key" ON "tenancy"."agency_staff_grants" USING btree ("org_id","grant_id","user_id") WHERE kind = 'team' and revoked_at is null;--> statement-breakpoint
CREATE INDEX "agency_staff_grants_org_grant_idx" ON "tenancy"."agency_staff_grants" USING btree ("org_id","grant_id");--> statement-breakpoint
CREATE INDEX "agency_staff_grants_agency_idx" ON "tenancy"."agency_staff_grants" USING btree ("agency_org_id") WHERE revoked_at is null;--> statement-breakpoint
ALTER TABLE "platform"."flags" ADD CONSTRAINT "flags_key_check" CHECK (key in ('open_signup', 'agency_v2')) NOT VALID;--> statement-breakpoint
-- hand-written: begin (M6.8b: validate the widened CHECK on the existing table separately)
ALTER TABLE "platform"."flags" VALIDATE CONSTRAINT "flags_key_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "brand_kits_tenant_isolation" ON "agency_ops"."brand_kits" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "detachments_tenant_isolation" ON "agency_ops"."detachments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "fanout_targets_tenant_isolation" ON "agency_ops"."fanout_targets" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "fanouts_tenant_isolation" ON "agency_ops"."fanouts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "publications_tenant_isolation" ON "agency_ops"."publications" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "received_items_tenant_isolation" ON "agency_ops"."received_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "template_settings_tenant_isolation" ON "agency_ops"."template_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "agency_staff_grants_tenant_isolation" ON "tenancy"."agency_staff_grants" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin (M6.8b: cross-module foreign keys, down the tiers: agency_ops 7 → templates 5, tenancy 1)
ALTER TABLE "agency_ops"."template_settings" ADD CONSTRAINT "template_settings_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency_ops"."template_settings" ADD CONSTRAINT "template_settings_template_fk" FOREIGN KEY ("org_id", "template_id") REFERENCES "templates"."event_templates"("org_id", "id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency_ops"."brand_kits" ADD CONSTRAINT "brand_kits_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency_ops"."publications" ADD CONSTRAINT "publications_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency_ops"."publications" ADD CONSTRAINT "publications_client_fk" FOREIGN KEY ("client_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency_ops"."received_items" ADD CONSTRAINT "received_items_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency_ops"."fanouts" ADD CONSTRAINT "fanouts_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency_ops"."fanout_targets" ADD CONSTRAINT "fanout_targets_client_fk" FOREIGN KEY ("client_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agency_ops"."detachments" ADD CONSTRAINT "detachments_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;
-- hand-written: end
--> statement-breakpoint
-- hand-written: begin (M6.8b: the agency_v2 platform switch, off until staff turn it on)
INSERT INTO platform.flags (key, enabled, updated_by) VALUES ('agency_v2', false, 'migration') ON CONFLICT (key) DO NOTHING;
-- hand-written: end
--> statement-breakpoint
-- hand-written: begin (M6.8b: team and day-of grants decide who acts through an agency grant)
-- The role through which `p_user` (whose membership role in the agency is `p_member_role`) acts
-- under grant `p_grant` of client `p_org` right now, or NULL for no access. With no live team row
-- for the grant, every agency member except collaborators acts with the grant's role (M6.7a). Once
-- a team is named, only team members do (at their team role). A live day-of pass inside its window
-- also gives access (collaborators included). Roles never exceed the grant's.
CREATE FUNCTION tenancy.agency_staff_role(p_org uuid, p_grant uuid, p_user uuid, p_member_role text, p_grant_role text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH ranks AS (
    SELECT s.kind, s.role FROM tenancy.agency_staff_grants s
    WHERE s.org_id = p_org AND s.grant_id = p_grant AND s.user_id = p_user AND s.revoked_at IS NULL
      AND (s.kind = 'team' OR (s.starts_at <= now() AND now() < s.ends_at))
  ), pick AS (
    SELECT CASE
      WHEN p_member_role <> 'collaborator' AND EXISTS (SELECT 1 FROM ranks WHERE kind = 'team')
        THEN (SELECT role FROM ranks WHERE kind = 'team' LIMIT 1)
      WHEN EXISTS (SELECT 1 FROM ranks WHERE kind = 'day_of')
        THEN (SELECT role FROM ranks WHERE kind = 'day_of'
              ORDER BY array_position(ARRAY['viewer', 'marketing', 'manager'], role) DESC LIMIT 1)
      WHEN p_member_role <> 'collaborator' AND NOT EXISTS (
        SELECT 1 FROM tenancy.agency_staff_grants t
        WHERE t.org_id = p_org AND t.grant_id = p_grant AND t.kind = 'team' AND t.revoked_at IS NULL)
        THEN p_grant_role
    END AS role
  )
  SELECT CASE
    WHEN pick.role IS NULL THEN NULL
    WHEN array_position(ARRAY['viewer', 'marketing', 'manager'], pick.role)
       > array_position(ARRAY['viewer', 'marketing', 'manager'], p_grant_role) THEN p_grant_role
    ELSE pick.role
  END FROM pick
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.agency_staff_role(uuid, uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
-- The live grant through which the transaction's user acts in the transaction's org (M6.7a), now
-- with the M6.8b team and day-of rules (the role is the effective one). Both ids come from the
-- transaction settings, never from a parameter.
CREATE OR REPLACE FUNCTION tenancy.agency_access()
RETURNS TABLE (grant_id uuid, agency_org_id uuid, agency_slug text, agency_name text, role text, finance boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT x.grant_id, x.agency_org_id, x.agency_slug, x.agency_name, x.role, x.finance FROM (
    SELECT g.id AS grant_id, a.id AS agency_org_id, a.slug AS agency_slug, a.name AS agency_name,
      tenancy.agency_staff_role(g.org_id, g.id, m.user_id, m.role, g.role) AS role, g.finance,
      g.created_at
    FROM tenancy.org_access_grants g
    JOIN tenancy.organizations a ON a.id = g.agency_org_id AND a.kind = 'agency' AND a.status IN ('active', 'limited')
    JOIN tenancy.memberships m ON m.org_id = a.id
    WHERE g.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
      AND m.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
      AND g.revoked_at IS NULL
  ) x
  WHERE x.role IS NOT NULL
  ORDER BY x.created_at, x.grant_id
  LIMIT 1
$$;
--> statement-breakpoint
-- Client orgs a user reaches through agencies right now (org switcher; M6.7a), with the team and
-- day-of rules, except orgs they are a direct member of. Allowlisted columns only.
CREATE OR REPLACE FUNCTION tenancy.user_agency_clients(p_user uuid)
RETURNS TABLE (org_id uuid, slug text, name text, agency_org_id uuid, agency_name text, role text, finance boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT x.org_id, x.slug, x.name, x.agency_org_id, x.agency_name, x.role, x.finance FROM (
    SELECT DISTINCT ON (c.id) c.id AS org_id, c.slug, c.name, a.id AS agency_org_id, a.name AS agency_name,
      r.role, g.finance
    FROM tenancy.memberships m
    JOIN tenancy.organizations a ON a.id = m.org_id AND a.kind = 'agency' AND a.status IN ('active', 'limited')
    JOIN tenancy.org_access_grants g ON g.agency_org_id = a.id AND g.revoked_at IS NULL
    JOIN tenancy.organizations c ON c.id = g.org_id AND c.status <> 'terminated'
    CROSS JOIN LATERAL (SELECT tenancy.agency_staff_role(g.org_id, g.id, m.user_id, m.role, g.role) AS role) r
    WHERE m.user_id = p_user AND r.role IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM tenancy.memberships d WHERE d.org_id = c.id AND d.user_id = p_user)
    ORDER BY c.id, g.created_at, g.id
  ) x
  ORDER BY x.name, x.org_id
$$;
--> statement-breakpoint
-- The live team places and day-of passes the transaction's org (an agency) holds in its clients:
-- allowlisted columns, the agency from the transaction settings (agency pages).
CREATE FUNCTION tenancy.agency_staff_of_agency()
RETURNS TABLE (id uuid, client_org_id uuid, grant_id uuid, agency_org_id uuid, user_id uuid, kind text, role text,
  event_id uuid, starts_at timestamptz, ends_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.id, s.org_id, s.grant_id, s.agency_org_id, s.user_id, s.kind, s.role, s.event_id, s.starts_at, s.ends_at,
    s.created_at
  FROM tenancy.agency_staff_grants s
  JOIN tenancy.org_access_grants g ON g.id = s.grant_id AND g.org_id = s.org_id AND g.revoked_at IS NULL
  WHERE s.agency_org_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND s.revoked_at IS NULL
  ORDER BY s.created_at DESC, s.id
  LIMIT 500
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.agency_staff_of_agency() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.agency_staff_of_agency() TO app_user;
-- hand-written: end
