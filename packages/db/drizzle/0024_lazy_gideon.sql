CREATE TABLE "ticketing"."holder_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"email_norm" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "holder_links_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "ticketing"."holder_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."holder_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticketing"."ticket_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"recipient_email" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by_email" text,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	CONSTRAINT "ticket_claims_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_claims" ADD CONSTRAINT "ticket_claims_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holder_links_org_id_idx" ON "ticketing"."holder_links" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "holder_links_org_email_idx" ON "ticketing"."holder_links" USING btree ("org_id","email_norm","created_at");--> statement-breakpoint
CREATE INDEX "ticket_claims_org_id_idx" ON "ticketing"."ticket_claims" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_claims_org_ticket_open_key" ON "ticketing"."ticket_claims" USING btree ("org_id","ticket_id") WHERE claimed_at is null and revoked_at is null;--> statement-breakpoint
CREATE POLICY "holder_links_tenant_isolation" ON "ticketing"."holder_links" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "ticket_claims_tenant_isolation" ON "ticketing"."ticket_claims" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpointALTER TABLE "ticketing"."holder_links" ADD CONSTRAINT "holder_links_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
-- A claim or holder link token carries only the row id (HMAC-verified in the app); these resolve
-- the id to its org before any tenant is known. Allowlisted columns only.
CREATE FUNCTION ticketing.claim_org(p_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT c.org_id FROM ticketing.ticket_claims c
  JOIN tenancy.organizations o ON o.id = c.org_id AND o.status IN ('active', 'limited')
  WHERE c.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ticketing.claim_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.claim_org(uuid) TO app_user;
--> statement-breakpoint
CREATE FUNCTION ticketing.holder_link_org(p_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT h.org_id FROM ticketing.holder_links h
  JOIN tenancy.organizations o ON o.id = h.org_id AND o.status IN ('active', 'limited')
  WHERE h.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ticketing.holder_link_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.holder_link_org(uuid) TO app_user;
