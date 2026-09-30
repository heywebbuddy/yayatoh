CREATE TABLE "orders"."waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"waitlist_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"occurrence_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"quantity" integer NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"position_at" timestamp with time zone NOT NULL,
	"offered_quantity" integer,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"offer_count" integer DEFAULT 0 NOT NULL,
	"offered_by" text,
	"order_id" uuid,
	"ended_at" timestamp with time zone,
	CONSTRAINT "waitlist_entries_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "waitlist_entries_status_check" CHECK (status in ('waiting', 'offered', 'accepted', 'expired', 'declined', 'left', 'removed')),
	CONSTRAINT "waitlist_entries_quantity_check" CHECK (quantity between 1 and 100),
	CONSTRAINT "waitlist_entries_offer_check" CHECK (status <> 'offered' or (offered_quantity between 1 and quantity and offer_expires_at is not null and offered_at is not null)),
	CONSTRAINT "waitlist_entries_offered_by_check" CHECK (offered_by is null or offered_by in ('auto', 'manual')),
	CONSTRAINT "waitlist_entries_email_lower_check" CHECK (email = lower(email))
);
--> statement-breakpoint
ALTER TABLE "orders"."waitlist_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."waitlist_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."waitlists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"occurrence_id" uuid,
	"auto_offer" boolean DEFAULT true NOT NULL,
	"offer_minutes" integer DEFAULT 1440 NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "waitlists_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "waitlists_offer_minutes_check" CHECK (offer_minutes between 15 and 10080)
);
--> statement-breakpoint
ALTER TABLE "orders"."waitlists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."waitlists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."waitlist_entries" ADD CONSTRAINT "waitlist_entries_waitlist_fk" FOREIGN KEY ("org_id","waitlist_id") REFERENCES "orders"."waitlists"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."waitlist_entries" ADD CONSTRAINT "waitlist_entries_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waitlist_entries_org_id_idx" ON "orders"."waitlist_entries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_org_queue_idx" ON "orders"."waitlist_entries" USING btree ("org_id","waitlist_id","status","position_at","id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_org_offer_idx" ON "orders"."waitlist_entries" USING btree ("org_id","offer_expires_at") WHERE status = 'offered';--> statement-breakpoint
CREATE INDEX "waitlist_entries_org_email_idx" ON "orders"."waitlist_entries" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "waitlist_entries_org_order_idx" ON "orders"."waitlist_entries" USING btree ("org_id","order_id") WHERE order_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_org_active_email_key" ON "orders"."waitlist_entries" USING btree ("org_id","waitlist_id","email") WHERE status in ('waiting', 'offered');--> statement-breakpoint
CREATE INDEX "waitlists_org_id_idx" ON "orders"."waitlists" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "waitlists_org_event_idx" ON "orders"."waitlists" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlists_org_type_key" ON "orders"."waitlists" USING btree ("org_id","ticket_type_id") WHERE occurrence_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlists_org_type_date_key" ON "orders"."waitlists" USING btree ("org_id","ticket_type_id","occurrence_id") WHERE occurrence_id is not null;--> statement-breakpoint
-- hand-written: begin
-- Widened CHECK on the existing guest_challenges table (M3.10a: waitlist email codes): NOT VALID + VALIDATE keeps the lock short.
ALTER TABLE "orders"."guest_challenges" DROP CONSTRAINT "guest_challenges_purpose_check";--> statement-breakpoint
ALTER TABLE "orders"."guest_challenges" ADD CONSTRAINT "guest_challenges_purpose_check" CHECK (purpose in ('checkout', 'sign_in', 'waitlist')) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."guest_challenges" VALIDATE CONSTRAINT "guest_challenges_purpose_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "waitlist_entries_tenant_isolation" ON "orders"."waitlist_entries" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "waitlists_tenant_isolation" ON "orders"."waitlists" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (orders 4 → events 2, ticketing 3); new tables, so no NOT VALID needed.
ALTER TABLE "orders"."waitlists" ADD CONSTRAINT "waitlists_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "orders"."waitlists" ADD CONSTRAINT "waitlists_ticket_type_fk" FOREIGN KEY ("org_id","ticket_type_id") REFERENCES "ticketing"."ticket_types"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "orders"."waitlists" ADD CONSTRAINT "waitlists_occurrence_fk" FOREIGN KEY ("org_id","occurrence_id") REFERENCES "events"."occurrences"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
-- Waitlist links: entry id (from a verified HMAC token) → its org. Ids only. Only live orgs
-- (M1.3f, like surveys.invitation_org): a suspended or terminated org's links are not found.
CREATE FUNCTION orders.waitlist_entry_org(p_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.org_id FROM orders.waitlist_entries e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  WHERE e.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orders.waitlist_entry_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orders.waitlist_entry_org(uuid) TO app_user;
--> statement-breakpoint
-- Waitlist sweeper (worker): orgs with lapsed offers, or people waiting on a list that offers
-- automatically. Org ids only.
CREATE FUNCTION orders.orgs_with_waitlist_work(p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT e.org_id FROM orders.waitlist_entries e
  JOIN orders.waitlists w ON w.org_id = e.org_id AND w.id = e.waitlist_id
  WHERE (e.status = 'offered' AND e.offer_expires_at <= now())
     OR (e.status = 'waiting' AND w.auto_offer)
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orders.orgs_with_waitlist_work(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orders.orgs_with_waitlist_work(integer) TO platform_reader;
-- hand-written: end
