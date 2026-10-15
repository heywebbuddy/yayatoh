ALTER TABLE "tenancy"."organizations" ADD COLUMN "require_two_factor" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- The two-step verification policy of each org a person belongs to (console gate and the
-- account security page): the same memberships as tenancy.user_memberships.
CREATE FUNCTION tenancy.user_two_factor_policies(p_user uuid)
RETURNS TABLE (org_id uuid, require_two_factor boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.id, o.require_two_factor
  FROM tenancy.memberships m JOIN tenancy.organizations o ON o.id = m.org_id
  WHERE m.user_id = p_user AND o.status <> 'terminated'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.user_two_factor_policies(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.user_two_factor_policies(uuid) TO app_user;
