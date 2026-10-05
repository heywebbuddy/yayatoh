-- M4.2b: gala tables (table tickets, purchased tables, guest slots linked to guests) and hosted
-- table sponsors.
CREATE TABLE "seating"."table_sponsors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"sponsor_name" text NOT NULL,
	"logo_url" text,
	"published" boolean DEFAULT false NOT NULL,
	CONSTRAINT "table_sponsors_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "table_sponsors_name_length" CHECK (length(sponsor_name) between 1 and 80),
	CONSTRAINT "table_sponsors_logo_check" CHECK (logo_url is null or (length(logo_url) <= 300 and logo_url ~ '^/media/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'))
);
--> statement-breakpoint
ALTER TABLE "seating"."table_sponsors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."table_sponsors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticketing"."table_units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"unit_no" integer NOT NULL,
	"size" integer NOT NULL,
	"link_sends" integer DEFAULT 0 NOT NULL,
	"last_link_sent_at" timestamp with time zone,
	"reminders" integer DEFAULT 0 NOT NULL,
	"last_reminded_at" timestamp with time zone,
	CONSTRAINT "table_units_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "table_units_size_check" CHECK (size between 2 and 20 and unit_no >= 1),
	CONSTRAINT "table_units_counts_check" CHECK (link_sends >= 0 and reminders >= 0)
);
--> statement-breakpoint
ALTER TABLE "ticketing"."table_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."table_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."parties" DROP CONSTRAINT "parties_source_check";--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" DROP CONSTRAINT "rsvp_history_source_check";--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" DROP CONSTRAINT "sub_event_responses_source_check";--> statement-breakpoint
ALTER TABLE "guests"."guests" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "guests"."parties" ADD COLUMN "table_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "table_size" integer;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" ADD COLUMN "table_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "ticketing"."table_units" ADD CONSTRAINT "table_units_ticket_type_fk" FOREIGN KEY ("org_id","ticket_type_id") REFERENCES "ticketing"."ticket_types"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_sponsors_org_id_idx" ON "seating"."table_sponsors" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "table_sponsors_org_event_item_key" ON "seating"."table_sponsors" USING btree ("org_id","event_id","item_id");--> statement-breakpoint
CREATE INDEX "table_units_org_id_idx" ON "ticketing"."table_units" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "table_units_org_item_unit_key" ON "ticketing"."table_units" USING btree ("org_id","order_item_id","unit_no");--> statement-breakpoint
CREATE INDEX "table_units_org_event_idx" ON "ticketing"."table_units" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "table_units_org_order_idx" ON "ticketing"."table_units" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_org_ticket_key" ON "guests"."guests" USING btree ("org_id","ticket_id") WHERE ticket_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_org_table_unit_key" ON "guests"."parties" USING btree ("org_id","table_unit_id") WHERE table_unit_id is not null;--> statement-breakpoint
CREATE INDEX "tickets_org_table_unit_idx" ON "ticketing"."tickets" USING btree ("org_id","table_unit_id") WHERE table_unit_id is not null;--> statement-breakpoint
CREATE POLICY "table_sponsors_tenant_isolation" ON "seating"."table_sponsors" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "table_units_tenant_isolation" ON "ticketing"."table_units" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint

-- hand-written: begin
-- M4.2b gala tables and sponsors. Existing tables: the widened source CHECKs and the table-size
-- CHECK are added NOT VALID then validated (short locks, expand only: every existing value stays
-- allowed); the new foreign keys on existing tables likewise.
ALTER TABLE "guests"."parties" ADD CONSTRAINT "parties_source_check" CHECK (source in ('manual', 'paper', 'import', 'collector', 'rsvp', 'table_link')) NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."parties" VALIDATE CONSTRAINT "parties_source_check";--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ADD CONSTRAINT "rsvp_history_source_check" CHECK (source in ('manual', 'paper', 'import', 'collector', 'rsvp', 'table_link')) NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" VALIDATE CONSTRAINT "rsvp_history_source_check";--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" ADD CONSTRAINT "sub_event_responses_source_check" CHECK (source in ('manual', 'paper', 'import', 'collector', 'rsvp', 'table_link')) NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" VALIDATE CONSTRAINT "sub_event_responses_source_check";--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD CONSTRAINT "ticket_types_table_size_check" CHECK (table_size is null or (table_size between 2 and 20 and not is_donation)) NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" VALIDATE CONSTRAINT "ticket_types_table_size_check";--> statement-breakpoint
-- A purchased table and a hosted table belong to one event of the org and go with it.
ALTER TABLE "ticketing"."table_units" ADD CONSTRAINT "table_units_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."table_sponsors" ADD CONSTRAINT "table_sponsors_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- A ticket that is a guest slot points at its table (same module, defined after tickets).
ALTER TABLE "ticketing"."tickets" ADD CONSTRAINT "tickets_table_unit_fk" FOREIGN KEY ("org_id","table_unit_id") REFERENCES "ticketing"."table_units"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" VALIDATE CONSTRAINT "tickets_table_unit_fk";--> statement-breakpoint
-- guests (same tier as ticketing) references its tables and tickets, never imports them; the link
-- clears if the row ever goes.
ALTER TABLE "guests"."parties" ADD CONSTRAINT "parties_table_unit_fk" FOREIGN KEY ("org_id","table_unit_id") REFERENCES "ticketing"."table_units"("org_id","id") ON DELETE SET NULL ("table_unit_id") NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."parties" VALIDATE CONSTRAINT "parties_table_unit_fk";--> statement-breakpoint
ALTER TABLE "guests"."guests" ADD CONSTRAINT "guests_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE SET NULL ("ticket_id") NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."guests" VALIDATE CONSTRAINT "guests_ticket_fk";--> statement-breakpoint
-- A table's claim link token carries only the table id (HMAC-verified in the app); this resolves
-- the id to its org before any tenant is known. Allowlisted columns only.
CREATE FUNCTION ticketing.table_unit_org(p_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT u.org_id FROM ticketing.table_units u
  JOIN tenancy.organizations o ON o.id = u.org_id AND o.status IN ('active', 'limited')
  WHERE u.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ticketing.table_unit_org(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.table_unit_org(uuid) TO app_user;--> statement-breakpoint
-- The event page: seats per table of the passes it may show (same filter as
-- public_ticket_type_occurrences_v2).
CREATE FUNCTION ticketing.public_ticket_type_tables(p_event_slug text, p_unlocked uuid[], p_private_ok boolean)
RETURNS TABLE (id uuid, table_size integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.id, t.table_size
  FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  JOIN ticketing.ticket_types t ON t.org_id = e.org_id AND t.event_id = e.id
  WHERE e.slug = lower(p_event_slug)
    AND e.status = 'published'
    AND (e.visibility IN ('public', 'unlisted') OR (p_private_ok AND e.visibility = 'private'))
    AND (t.visibility = 'public' OR t.id = ANY (coalesce(p_unlocked, '{}'::uuid[])))
    AND t.archived_at IS NULL
    AND t.table_size IS NOT NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION ticketing.public_ticket_type_tables(text, uuid[], boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ticketing.public_ticket_type_tables(text, uuid[], boolean) TO app_user;
-- hand-written: end
