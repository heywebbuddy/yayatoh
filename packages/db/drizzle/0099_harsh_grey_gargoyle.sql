CREATE TABLE "guests"."party_rsvp" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"link_expires_at" timestamp with time zone NOT NULL,
	"pin_version" integer DEFAULT 1 NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"reopened" boolean DEFAULT false NOT NULL,
	CONSTRAINT "party_rsvp_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "party_rsvp_pin_version_check" CHECK (pin_version >= 1)
);
--> statement-breakpoint
ALTER TABLE "guests"."party_rsvp" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."party_rsvp" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."rsvp_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"deadline" timestamp with time zone,
	"name_lookup" boolean DEFAULT true NOT NULL,
	"lookup_code" text NOT NULL,
	CONSTRAINT "rsvp_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "rsvp_settings_lookup_code_check" CHECK (lookup_code ~ '^[0-9A-Z_]{8,40}$')
);
--> statement-breakpoint
ALTER TABLE "guests"."rsvp_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" DROP CONSTRAINT "rsvp_history_action_check";--> statement-breakpoint
ALTER TABLE "crm"."event_participation" ADD COLUMN "rsvp" text;--> statement-breakpoint
ALTER TABLE "guests"."party_rsvp" ADD CONSTRAINT "party_rsvp_party_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "guests"."parties"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "party_rsvp_org_id_idx" ON "guests"."party_rsvp" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_rsvp_org_party_key" ON "guests"."party_rsvp" USING btree ("org_id","party_id");--> statement-breakpoint
CREATE INDEX "party_rsvp_org_event_idx" ON "guests"."party_rsvp" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_rsvp_link_key" ON "guests"."party_rsvp" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "rsvp_settings_org_id_idx" ON "guests"."rsvp_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvp_settings_org_event_key" ON "guests"."rsvp_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvp_settings_lookup_code_key" ON "guests"."rsvp_settings" USING btree ("lookup_code");--> statement-breakpoint
ALTER TABLE "crm"."event_participation" ADD CONSTRAINT "event_participation_rsvp_check" CHECK (rsvp is null or rsvp in ('attending', 'declined', 'awaiting')) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."event_participation" VALIDATE CONSTRAINT "event_participation_rsvp_check";--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ADD CONSTRAINT "rsvp_history_action_check" CHECK (action in ('party_created', 'party_updated', 'party_removed', 'guest_added', 'guest_updated', 'guest_removed', 'guest_moved', 'plus_one_added', 'plus_one_named', 'sub_event_created', 'sub_event_updated', 'sub_event_moved', 'sub_event_removed', 'invitation_added', 'invitation_removed', 'response_recorded', 'response_cleared', 'rsvp_link_created', 'rsvp_link_reset', 'rsvp_pin_reset', 'rsvp_sent', 'rsvp_viewed', 'rsvp_submitted', 'rsvp_reopened')) NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" VALIDATE CONSTRAINT "rsvp_history_action_check";--> statement-breakpoint
CREATE POLICY "party_rsvp_tenant_isolation" ON "guests"."party_rsvp" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "rsvp_settings_tenant_isolation" ON "guests"."rsvp_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.1d cross-module composite FKs (guests is tier 3, events tier 2): a party's RSVP row and an
-- event's RSVP settings belong to one event of the org; the event takes them with it.
ALTER TABLE "guests"."party_rsvp" ADD CONSTRAINT "party_rsvp_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_settings" ADD CONSTRAINT "rsvp_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- Party RSVP links: link id (from a verified HMAC token) → its org. Ids only. Only live orgs
-- (M1.3f, like surveys.invitation_org): a suspended or terminated org's links are not found.
CREATE FUNCTION guests.rsvp_link_org(p_link uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT r.org_id FROM guests.party_rsvp r
  JOIN tenancy.organizations o ON o.id = r.org_id AND o.status IN ('active', 'limited')
  WHERE r.link_id = p_link
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION guests.rsvp_link_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION guests.rsvp_link_org(uuid) TO app_user;
--> statement-breakpoint
-- The paper fallback's address: lookup code → org and event, only while the host keeps name
-- lookup on and the org is live. Ids only; nothing about the guests.
CREATE FUNCTION guests.rsvp_lookup_target(p_code text)
RETURNS TABLE (org_id uuid, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.org_id, s.event_id FROM guests.rsvp_settings s
  JOIN tenancy.organizations o ON o.id = s.org_id AND o.status IN ('active', 'limited')
  WHERE s.lookup_code = p_code AND s.name_lookup
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION guests.rsvp_lookup_target(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION guests.rsvp_lookup_target(text) TO app_user;
-- hand-written: end
