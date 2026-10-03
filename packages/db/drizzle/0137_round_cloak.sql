CREATE TABLE "engagement"."meeting_locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"capacity" integer NOT NULL,
	CONSTRAINT "meeting_locations_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "meeting_locations_kind_check" CHECK (kind in ('booth', 'meeting_point')),
	CONSTRAINT "meeting_locations_name_check" CHECK (char_length(name) between 1 and 80),
	CONSTRAINT "meeting_locations_capacity_check" CHECK (capacity between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "engagement"."meeting_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."meeting_locations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."meeting_slots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "meeting_slots_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "meeting_slots_order_check" CHECK (ends_at > starts_at),
	CONSTRAINT "meeting_slots_length_check" CHECK (ends_at - starts_at <= interval '4 hours')
);
--> statement-breakpoint
ALTER TABLE "engagement"."meeting_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."meeting_slots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."meetings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"table_no" integer,
	"message" text,
	"responded_at" timestamp with time zone,
	CONSTRAINT "meetings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "meetings_status_check" CHECK (status in ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "meetings_self_check" CHECK (requester_id <> invitee_id),
	CONSTRAINT "meetings_table_check" CHECK ((status = 'accepted') = (table_no is not null) and (table_no is null or table_no between 1 and 50)),
	CONSTRAINT "meetings_message_check" CHECK (message is null or char_length(message) between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "engagement"."meetings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."meetings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."network_blocks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	CONSTRAINT "network_blocks_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "network_blocks_self_check" CHECK (blocker_id <> blocked_id)
);
--> statement-breakpoint
ALTER TABLE "engagement"."network_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."network_blocks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."network_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"responded_at" timestamp with time zone,
	CONSTRAINT "network_connections_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "network_connections_status_check" CHECK (status in ('pending', 'accepted', 'declined', 'withdrawn')),
	CONSTRAINT "network_connections_self_check" CHECK (requester_id <> addressee_id),
	CONSTRAINT "network_connections_message_check" CHECK (message is null or char_length(message) between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "engagement"."network_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."network_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."network_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"opted_in_at" timestamp with time zone,
	"display_name" text NOT NULL,
	"headline" text,
	"company" text,
	"bio" text,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	CONSTRAINT "network_profiles_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "network_profiles_display_name_check" CHECK (char_length(display_name) between 1 and 80),
	CONSTRAINT "network_profiles_headline_check" CHECK (headline is null or char_length(headline) between 1 and 80),
	CONSTRAINT "network_profiles_company_check" CHECK (company is null or char_length(company) between 1 and 80),
	CONSTRAINT "network_profiles_bio_check" CHECK (bio is null or char_length(bio) between 1 and 500),
	CONSTRAINT "network_profiles_interests_check" CHECK (cardinality(interests) <= 10),
	CONSTRAINT "network_profiles_opted_in_at_check" CHECK (not opted_in or opted_in_at is not null)
);
--> statement-breakpoint
ALTER TABLE "engagement"."network_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."network_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."network_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reported_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "network_reports_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "network_reports_reason_check" CHECK (reason in ('spam', 'harassment', 'inappropriate', 'fake', 'other')),
	CONSTRAINT "network_reports_status_check" CHECK (status in ('open', 'hidden', 'dismissed')),
	CONSTRAINT "network_reports_details_check" CHECK (details is null or char_length(details) between 1 and 500),
	CONSTRAINT "network_reports_self_check" CHECK (reporter_id <> reported_id),
	CONSTRAINT "network_reports_resolved_check" CHECK ((status = 'open') = (resolved_at is null))
);
--> statement-breakpoint
ALTER TABLE "engagement"."network_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."network_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."network_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"meetings_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "network_settings_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "engagement"."network_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."network_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."meetings" ADD CONSTRAINT "meetings_slot_fk" FOREIGN KEY ("org_id","slot_id") REFERENCES "engagement"."meeting_slots"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."meetings" ADD CONSTRAINT "meetings_location_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "engagement"."meeting_locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."meetings" ADD CONSTRAINT "meetings_requester_fk" FOREIGN KEY ("org_id","requester_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."meetings" ADD CONSTRAINT "meetings_invitee_fk" FOREIGN KEY ("org_id","invitee_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."network_blocks" ADD CONSTRAINT "network_blocks_blocker_fk" FOREIGN KEY ("org_id","blocker_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."network_blocks" ADD CONSTRAINT "network_blocks_blocked_fk" FOREIGN KEY ("org_id","blocked_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."network_connections" ADD CONSTRAINT "network_connections_requester_fk" FOREIGN KEY ("org_id","requester_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."network_connections" ADD CONSTRAINT "network_connections_addressee_fk" FOREIGN KEY ("org_id","addressee_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."network_reports" ADD CONSTRAINT "network_reports_reporter_fk" FOREIGN KEY ("org_id","reporter_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement"."network_reports" ADD CONSTRAINT "network_reports_reported_fk" FOREIGN KEY ("org_id","reported_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_locations_org_id_idx" ON "engagement"."meeting_locations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_locations_org_event_name_key" ON "engagement"."meeting_locations" USING btree ("org_id","event_id",lower(name));--> statement-breakpoint
CREATE INDEX "meeting_slots_org_id_idx" ON "engagement"."meeting_slots" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_slots_org_event_start_key" ON "engagement"."meeting_slots" USING btree ("org_id","event_id","starts_at");--> statement-breakpoint
CREATE INDEX "meetings_org_id_idx" ON "engagement"."meetings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_org_location_slot_table_key" ON "engagement"."meetings" USING btree ("org_id","location_id","slot_id","table_no") WHERE status = 'accepted';--> statement-breakpoint
CREATE INDEX "meetings_org_requester_idx" ON "engagement"."meetings" USING btree ("org_id","requester_id","status");--> statement-breakpoint
CREATE INDEX "meetings_org_invitee_idx" ON "engagement"."meetings" USING btree ("org_id","invitee_id","status");--> statement-breakpoint
CREATE INDEX "meetings_org_slot_idx" ON "engagement"."meetings" USING btree ("org_id","slot_id","status");--> statement-breakpoint
CREATE INDEX "meetings_org_event_idx" ON "engagement"."meetings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "network_blocks_org_id_idx" ON "engagement"."network_blocks" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_blocks_org_pair_key" ON "engagement"."network_blocks" USING btree ("org_id","blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "network_blocks_org_blocked_idx" ON "engagement"."network_blocks" USING btree ("org_id","blocked_id");--> statement-breakpoint
CREATE INDEX "network_blocks_org_event_idx" ON "engagement"."network_blocks" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "network_connections_org_id_idx" ON "engagement"."network_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_connections_org_pair_key" ON "engagement"."network_connections" USING btree ("org_id",least(requester_id, addressee_id),greatest(requester_id, addressee_id));--> statement-breakpoint
CREATE INDEX "network_connections_org_requester_idx" ON "engagement"."network_connections" USING btree ("org_id","requester_id","status");--> statement-breakpoint
CREATE INDEX "network_connections_org_addressee_idx" ON "engagement"."network_connections" USING btree ("org_id","addressee_id","status");--> statement-breakpoint
CREATE INDEX "network_connections_org_event_idx" ON "engagement"."network_connections" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "network_profiles_org_id_idx" ON "engagement"."network_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_profiles_org_event_contact_key" ON "engagement"."network_profiles" USING btree ("org_id","event_id","contact_id");--> statement-breakpoint
CREATE INDEX "network_profiles_org_event_listed_idx" ON "engagement"."network_profiles" USING btree ("org_id","event_id","display_name") WHERE opted_in and hidden_at is null;--> statement-breakpoint
CREATE INDEX "network_reports_org_id_idx" ON "engagement"."network_reports" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_reports_org_open_pair_key" ON "engagement"."network_reports" USING btree ("org_id","reporter_id","reported_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "network_reports_org_event_status_idx" ON "engagement"."network_reports" USING btree ("org_id","event_id","status","created_at");--> statement-breakpoint
CREATE INDEX "network_reports_org_reported_idx" ON "engagement"."network_reports" USING btree ("org_id","reported_id");--> statement-breakpoint
CREATE INDEX "network_settings_org_id_idx" ON "engagement"."network_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_settings_org_event_key" ON "engagement"."network_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "meeting_locations_tenant_isolation" ON "engagement"."meeting_locations" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "meeting_slots_tenant_isolation" ON "engagement"."meeting_slots" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "meetings_tenant_isolation" ON "engagement"."meetings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "network_blocks_tenant_isolation" ON "engagement"."network_blocks" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "network_connections_tenant_isolation" ON "engagement"."network_connections" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "network_profiles_tenant_isolation" ON "engagement"."network_profiles" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "network_reports_tenant_isolation" ON "engagement"."network_reports" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "network_settings_tenant_isolation" ON "engagement"."network_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M5.8a cross-module FKs, down the tiers (engagement 5 → events 2, crm 1); new tables, so no NOT VALID needed.
ALTER TABLE "engagement"."network_settings" ADD CONSTRAINT "network_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."network_profiles" ADD CONSTRAINT "network_profiles_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."network_connections" ADD CONSTRAINT "network_connections_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."network_blocks" ADD CONSTRAINT "network_blocks_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."network_reports" ADD CONSTRAINT "network_reports_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."meeting_locations" ADD CONSTRAINT "meeting_locations_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."meeting_slots" ADD CONSTRAINT "meeting_slots_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."meetings" ADD CONSTRAINT "meetings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engagement"."network_profiles" ADD CONSTRAINT "network_profiles_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade;
-- hand-written: end
