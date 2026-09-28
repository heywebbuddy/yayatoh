CREATE SCHEMA "guests";
--> statement-breakpoint
CREATE TABLE "guests"."guests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text DEFAULT 'guest' NOT NULL,
	"host_guest_id" uuid,
	"first_name" text,
	"last_name" text,
	"age_class" text DEFAULT 'adult' NOT NULL,
	"meal" text,
	"private_ciphertext" text,
	"attendee_id" uuid,
	"contact_id" uuid,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "guests_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "guests_kind_check" CHECK (kind in ('guest', 'plus_one')),
	CONSTRAINT "guests_age_class_check" CHECK (age_class in ('adult', 'child', 'infant')),
	CONSTRAINT "guests_kind_shape" CHECK ((kind = 'guest' and host_guest_id is null and first_name is not null) or (kind = 'plus_one' and host_guest_id is not null and not is_primary)),
	CONSTRAINT "guests_first_name_length" CHECK (first_name is null or length(first_name) between 1 and 80),
	CONSTRAINT "guests_last_name_length" CHECK (last_name is null or length(last_name) between 1 and 80),
	CONSTRAINT "guests_meal_length" CHECK (meal is null or length(meal) between 1 and 80),
	CONSTRAINT "guests_not_own_host" CHECK (host_guest_id is null or host_guest_id <> id)
);
--> statement-breakpoint
ALTER TABLE "guests"."guests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."guests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."parties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"envelope_name" text,
	"side" text,
	"vip" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "parties_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "parties_name_length" CHECK (length(name) between 1 and 120),
	CONSTRAINT "parties_envelope_length" CHECK (envelope_name is null or length(envelope_name) between 1 and 200),
	CONSTRAINT "parties_side_length" CHECK (side is null or length(side) between 1 and 40),
	CONSTRAINT "parties_tags_check" CHECK (cardinality(tags) <= 20),
	CONSTRAINT "parties_notes_length" CHECK (length(notes) <= 2000),
	CONSTRAINT "parties_source_check" CHECK (source in ('manual', 'paper', 'import', 'collector', 'rsvp'))
);
--> statement-breakpoint
ALTER TABLE "guests"."parties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."parties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."rsvp_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"guest_id" uuid,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "rsvp_history_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "rsvp_history_action_check" CHECK (action in ('party_created', 'party_updated', 'party_removed', 'guest_added', 'guest_updated', 'guest_removed', 'guest_moved', 'plus_one_added', 'plus_one_named')),
	CONSTRAINT "rsvp_history_source_check" CHECK (source in ('manual', 'paper', 'import', 'collector', 'rsvp'))
);
--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."guests" ADD CONSTRAINT "guests_party_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "guests"."parties"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests"."guests" ADD CONSTRAINT "guests_host_fk" FOREIGN KEY ("org_id","host_guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guests_org_id_idx" ON "guests"."guests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "guests_org_party_idx" ON "guests"."guests" USING btree ("org_id","party_id","created_at");--> statement-breakpoint
CREATE INDEX "guests_org_event_idx" ON "guests"."guests" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_org_party_primary_key" ON "guests"."guests" USING btree ("org_id","party_id") WHERE is_primary;--> statement-breakpoint
CREATE UNIQUE INDEX "guests_org_host_key" ON "guests"."guests" USING btree ("org_id","host_guest_id") WHERE host_guest_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "guests_org_attendee_key" ON "guests"."guests" USING btree ("org_id","attendee_id") WHERE attendee_id is not null;--> statement-breakpoint
CREATE INDEX "guests_org_contact_idx" ON "guests"."guests" USING btree ("org_id","contact_id") WHERE contact_id is not null;--> statement-breakpoint
CREATE INDEX "parties_org_id_idx" ON "guests"."parties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "parties_org_event_idx" ON "guests"."parties" USING btree ("org_id","event_id","name");--> statement-breakpoint
CREATE INDEX "rsvp_history_org_id_idx" ON "guests"."rsvp_history" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "rsvp_history_org_party_idx" ON "guests"."rsvp_history" USING btree ("org_id","party_id","created_at");--> statement-breakpoint
CREATE INDEX "rsvp_history_org_event_idx" ON "guests"."rsvp_history" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE POLICY "guests_tenant_isolation" ON "guests"."guests" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "parties_tenant_isolation" ON "guests"."parties" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "rsvp_history_tenant_isolation" ON "guests"."rsvp_history" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.1a cross-module composite FKs (guests is tier 3; events and attendees tier 2, crm tier 1).
-- Every party, guest and history row belongs to one event of the org; the event takes them with it.
ALTER TABLE "guests"."parties" ADD CONSTRAINT "parties_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."guests" ADD CONSTRAINT "guests_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ADD CONSTRAINT "rsvp_history_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- A guest may point at a guest-list entry and its CRM contact; the link clears if either goes.
ALTER TABLE "guests"."guests" ADD CONSTRAINT "guests_attendee_fk" FOREIGN KEY ("org_id","attendee_id") REFERENCES "attendees"."attendees"("org_id","id") ON DELETE SET NULL ("attendee_id");--> statement-breakpoint
ALTER TABLE "guests"."guests" ADD CONSTRAINT "guests_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE SET NULL ("contact_id");--> statement-breakpoint
-- The change history is append-only for the runtime role.
REVOKE UPDATE, DELETE, TRUNCATE ON "guests"."rsvp_history" FROM app_user;
-- hand-written: end
