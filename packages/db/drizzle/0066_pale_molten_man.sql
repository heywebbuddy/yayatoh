-- M4.2a: co-host and planner event roles, the collaborator org role, event invitations.
ALTER TABLE "events"."event_role_assignments" DROP CONSTRAINT "event_role_assignments_role_check";--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" DROP CONSTRAINT "invitations_role_check";--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" DROP CONSTRAINT "memberships_role_check";--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" ADD COLUMN "event_role" text;--> statement-breakpoint
CREATE INDEX "invitations_org_event_idx" ON "tenancy"."invitations" USING btree ("org_id","event_id");--> statement-breakpoint
-- hand-written: begin
-- Existing tables: the widened CHECKs are added NOT VALID then validated (short locks, expand only:
-- every existing value stays allowed).
ALTER TABLE "events"."event_role_assignments" ADD CONSTRAINT "event_role_assignments_role_check" CHECK (role in ('event_manager', 'door_staff', 'seating_manager', 'session_scanner', 'exhibitor_admin', 'exhibitor_staff', 'speaker', 'sponsor_contact', 'kiosk_operator', 'venue_viewer', 'co_host', 'planner')) NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."event_role_assignments" VALIDATE CONSTRAINT "event_role_assignments_role_check";--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" ADD CONSTRAINT "invitations_event_role_check" CHECK ((event_id is null and event_role is null) or (event_id is not null and event_role in ('co_host', 'planner'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" VALIDATE CONSTRAINT "invitations_event_role_check";--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" ADD CONSTRAINT "invitations_role_check" CHECK (role in ('owner', 'admin', 'manager', 'finance', 'marketing', 'box_office', 'scanner', 'viewer', 'collaborator')) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" VALIDATE CONSTRAINT "invitations_role_check";--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_role_check" CHECK (role in ('owner', 'admin', 'manager', 'finance', 'marketing', 'box_office', 'scanner', 'viewer', 'collaborator')) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" VALIDATE CONSTRAINT "memberships_role_check";--> statement-breakpoint
-- Cross-module FK (hand-written: tenancy can't import events). An event invitation goes with its
-- event. Tier 1 → tier 2 is an upward reference, but only as a DB constraint; no code imports.
ALTER TABLE "tenancy"."invitations" ADD CONSTRAINT "invitations_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" VALIDATE CONSTRAINT "invitations_event_fk";--> statement-breakpoint
-- The accept page names the event before the invitee belongs to the org (cross-tenant by nature,
-- like tenancy.invitation_status). Allowlisted columns only: the event name and the event role.
CREATE FUNCTION events.invitation_event(p_invitation_id uuid)
RETURNS TABLE (event_name text, event_role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.name, i.event_role
  FROM tenancy.invitations i
  JOIN events.events e ON e.org_id = i.org_id AND e.id = i.event_id
  WHERE i.id = p_invitation_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.invitation_event(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.invitation_event(uuid) TO app_user;
-- hand-written: end
