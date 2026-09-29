CREATE SCHEMA "audiences";
--> statement-breakpoint
CREATE TABLE "audiences"."segments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "segments_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "segments_name_check" CHECK (length(btrim(name)) between 1 and 120),
	CONSTRAINT "segments_definition_check" CHECK (jsonb_typeof(definition) = 'object')
);
--> statement-breakpoint
ALTER TABLE "audiences"."segments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audiences"."segments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."contact_profile" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"events_attended" integer DEFAULT 0 NOT NULL,
	"tickets" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"email_consent" text DEFAULT 'none' NOT NULL,
	"sms_consent" text DEFAULT 'none' NOT NULL,
	CONSTRAINT "contact_profile_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contact_profile_counts_check" CHECK (events >= 0 and events_attended >= 0 and tickets >= 0 and orders >= 0),
	CONSTRAINT "contact_profile_seen_check" CHECK (last_seen_at is null or last_seen_at >= first_seen_at),
	CONSTRAINT "contact_profile_labels_check" CHECK (cardinality(labels) <= 200),
	CONSTRAINT "contact_profile_consent_check" CHECK (email_consent in ('granted', 'withdrawn', 'unknown_legacy', 'none') and sms_consent in ('granted', 'withdrawn', 'unknown_legacy', 'none'))
);
--> statement-breakpoint
ALTER TABLE "crm"."contact_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contact_profile" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."event_participation" ADD COLUMN "registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."event_participation" ADD COLUMN "orders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."event_participation" ADD COLUMN "labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."contact_profile" ADD CONSTRAINT "contact_profile_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segments_org_id_idx" ON "audiences"."segments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_org_name_key" ON "audiences"."segments" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "segments_org_updated_idx" ON "audiences"."segments" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "contact_profile_org_id_idx" ON "crm"."contact_profile" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_profile_org_contact_key" ON "crm"."contact_profile" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_profile_org_last_seen_idx" ON "crm"."contact_profile" USING btree ("org_id","last_seen_at");--> statement-breakpoint
-- hand-written: begin (CHECKs on an existing table: NOT VALID, then VALIDATE without a long lock)
ALTER TABLE "crm"."event_participation" ADD CONSTRAINT "event_participation_orders_check" CHECK (orders >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."event_participation" VALIDATE CONSTRAINT "event_participation_orders_check";--> statement-breakpoint
ALTER TABLE "crm"."event_participation" ADD CONSTRAINT "event_participation_labels_check" CHECK (cardinality(labels) <= 60) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."event_participation" VALIDATE CONSTRAINT "event_participation_labels_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "segments_tenant_isolation" ON "audiences"."segments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "contact_profile_tenant_isolation" ON "crm"."contact_profile" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin (M3.6 contact_profile projection)
-- Rebuild the profiles of some (or, with NULL, all) of an org's contacts from event_participation
-- and the consent ledger. SECURITY INVOKER: at runtime it runs as app_user under the tenant's RLS;
-- the backfill below runs it as the migrator. One definition for the projector and the backfill.
CREATE FUNCTION crm.refresh_contact_profiles(p_org uuid, p_contacts uuid[]) RETURNS integer
LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog AS $$
  WITH target AS (
    SELECT c.id FROM crm.contacts c
    WHERE c.org_id = p_org AND (p_contacts IS NULL OR c.id = ANY (p_contacts))
  ), part AS (
    SELECT p.contact_id,
           count(*) FILTER (WHERE p.registered)::int AS events,
           count(*) FILTER (WHERE p.registered AND p.checked_in)::int AS events_attended,
           coalesce(sum(p.tickets), 0)::int AS tickets,
           coalesce(sum(p.orders), 0)::int AS orders,
           min(p.registered_at) AS first_seen_at,
           max(p.registered_at) AS last_seen_at
    FROM crm.event_participation p JOIN target t ON t.id = p.contact_id
    WHERE p.org_id = p_org
    GROUP BY p.contact_id
  ), lbl AS (
    SELECT p.contact_id, array_agg(DISTINCT l.label ORDER BY l.label) AS labels
    FROM crm.event_participation p JOIN target t ON t.id = p.contact_id
    CROSS JOIN LATERAL unnest(p.labels) AS l(label)
    WHERE p.org_id = p_org AND p.registered
    GROUP BY p.contact_id
  ), cons AS (
    SELECT DISTINCT ON (k.contact_id, k.channel) k.contact_id, k.channel, k.status
    FROM crm.consents k JOIN target t ON t.id = k.contact_id
    WHERE k.org_id = p_org AND k.purpose = 'marketing'
    ORDER BY k.contact_id, k.channel, k.captured_at DESC, k.id DESC
  ), up AS (
    INSERT INTO crm.contact_profile AS cp (org_id, contact_id, events, events_attended, tickets, orders,
                                           first_seen_at, last_seen_at, labels, email_consent, sms_consent,
                                           updated_at)
    SELECT p_org, t.id, coalesce(pa.events, 0), coalesce(pa.events_attended, 0), coalesce(pa.tickets, 0),
           coalesce(pa.orders, 0), pa.first_seen_at, pa.last_seen_at,
           coalesce(lb.labels[1:200], '{}'::text[]), coalesce(e.status, 'none'), coalesce(s.status, 'none'), now()
    FROM target t
    LEFT JOIN part pa ON pa.contact_id = t.id
    LEFT JOIN lbl lb ON lb.contact_id = t.id
    LEFT JOIN cons e ON e.contact_id = t.id AND e.channel = 'email'
    LEFT JOIN cons s ON s.contact_id = t.id AND s.channel = 'sms'
    ON CONFLICT (org_id, contact_id) DO UPDATE SET
      events = excluded.events, events_attended = excluded.events_attended, tickets = excluded.tickets,
      orders = excluded.orders, first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at,
      labels = excluded.labels, email_consent = excluded.email_consent, sms_consent = excluded.sms_consent,
      updated_at = excluded.updated_at
    RETURNING 1
  )
  SELECT count(*)::int FROM up
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION crm.refresh_contact_profiles(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION crm.refresh_contact_profiles(uuid, uuid[]) TO app_user;
--> statement-breakpoint
-- Legacy history (M2.2c) predates the new columns: a legacy row with tickets was on the list.
UPDATE crm.event_participation SET registered = true WHERE source = 'legacy' AND tickets > 0 AND NOT registered;
--> statement-breakpoint
-- Backfill: one profile per existing contact (the projector keeps them current from here on).
SELECT crm.refresh_contact_profiles(o.org_id, NULL) FROM (SELECT DISTINCT org_id FROM crm.contacts) o;
-- hand-written: end

