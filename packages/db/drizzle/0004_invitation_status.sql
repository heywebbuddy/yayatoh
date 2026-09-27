-- Invitation status for the accept page and acceptInvitation (M1.2b). Cross-tenant by nature:
-- the token names an invitation before any tenant is known. Returns allowlisted columns only.
CREATE FUNCTION tenancy.invitation_status(p_id uuid)
RETURNS TABLE (org_id uuid, org_name text, email text, role text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT i.org_id, o.name, i.email, i.role,
         CASE
           WHEN i.accepted_at IS NOT NULL THEN 'accepted'
           WHEN i.revoked_at IS NOT NULL THEN 'revoked'
           WHEN i.expires_at <= now() THEN 'expired'
           WHEN o.status IN ('suspended', 'terminated') THEN 'unavailable'
           ELSE 'pending'
         END
  FROM tenancy.invitations i JOIN tenancy.organizations o ON o.id = i.org_id
  WHERE i.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.invitation_status(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.invitation_status(uuid) TO app_user;
