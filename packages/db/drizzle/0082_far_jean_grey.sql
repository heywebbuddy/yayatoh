CREATE TABLE "guests"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sub_event_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	CONSTRAINT "invitations_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "guests"."invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."sub_event_responses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sub_event_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "sub_event_responses_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sub_event_responses_status_check" CHECK (status in ('attending', 'declined')),
	CONSTRAINT "sub_event_responses_source_check" CHECK (source in ('manual', 'paper', 'import', 'collector', 'rsvp'))
);
--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."sub_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"place" text,
	"venue_id" uuid,
	"occurrence_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"invite_all" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sub_events_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sub_events_name_length" CHECK (length(name) between 1 and 120),
	CONSTRAINT "sub_events_kind_check" CHECK (kind in ('ceremony', 'reception', 'rehearsal_dinner', 'custom')),
	CONSTRAINT "sub_events_place_length" CHECK (place is null or length(place) between 1 and 200),
	CONSTRAINT "sub_events_time_order" CHECK (ends_at > starts_at)
);
--> statement-breakpoint
ALTER TABLE "guests"."sub_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."sub_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" DROP CONSTRAINT "rsvp_history_action_check";--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ALTER COLUMN "party_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ADD COLUMN "sub_event_id" uuid;--> statement-breakpoint
ALTER TABLE "guests"."invitations" ADD CONSTRAINT "invitations_sub_event_fk" FOREIGN KEY ("org_id","sub_event_id") REFERENCES "guests"."sub_events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests"."invitations" ADD CONSTRAINT "invitations_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" ADD CONSTRAINT "sub_event_responses_sub_event_fk" FOREIGN KEY ("org_id","sub_event_id") REFERENCES "guests"."sub_events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" ADD CONSTRAINT "sub_event_responses_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_org_id_idx" ON "guests"."invitations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_org_sub_event_guest_key" ON "guests"."invitations" USING btree ("org_id","sub_event_id","guest_id");--> statement-breakpoint
CREATE INDEX "invitations_org_guest_idx" ON "guests"."invitations" USING btree ("org_id","guest_id");--> statement-breakpoint
CREATE INDEX "invitations_org_event_idx" ON "guests"."invitations" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "sub_event_responses_org_id_idx" ON "guests"."sub_event_responses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_event_responses_org_sub_event_guest_key" ON "guests"."sub_event_responses" USING btree ("org_id","sub_event_id","guest_id");--> statement-breakpoint
CREATE INDEX "sub_event_responses_org_guest_idx" ON "guests"."sub_event_responses" USING btree ("org_id","guest_id");--> statement-breakpoint
CREATE INDEX "sub_event_responses_org_event_idx" ON "guests"."sub_event_responses" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "sub_events_org_id_idx" ON "guests"."sub_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sub_events_org_event_idx" ON "guests"."sub_events" USING btree ("org_id","event_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_events_org_event_id_key" ON "guests"."sub_events" USING btree ("org_id","event_id","id");--> statement-breakpoint
CREATE INDEX "rsvp_history_org_sub_event_idx" ON "guests"."rsvp_history" USING btree ("org_id","sub_event_id","created_at") WHERE sub_event_id is not null;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ADD CONSTRAINT "rsvp_history_party_check" CHECK (party_id is not null or sub_event_id is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" VALIDATE CONSTRAINT "rsvp_history_party_check";--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ADD CONSTRAINT "rsvp_history_action_check" CHECK (action in ('party_created', 'party_updated', 'party_removed', 'guest_added', 'guest_updated', 'guest_removed', 'guest_moved', 'plus_one_added', 'plus_one_named', 'sub_event_created', 'sub_event_updated', 'sub_event_moved', 'sub_event_removed', 'invitation_added', 'invitation_removed', 'response_recorded', 'response_cleared')) NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" VALIDATE CONSTRAINT "rsvp_history_action_check";--> statement-breakpoint
CREATE POLICY "invitations_tenant_isolation" ON "guests"."invitations" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sub_event_responses_tenant_isolation" ON "guests"."sub_event_responses" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sub_events_tenant_isolation" ON "guests"."sub_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));;--> statement-breakpoint
-- hand-written: begin
-- M4.1c cross-module composite FKs (guests is tier 3; events tier 2, venues tier 1). A sub-event,
-- an invitation and a response belong to one event of the org; the event takes them with it.
ALTER TABLE "guests"."sub_events" ADD CONSTRAINT "sub_events_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."invitations" ADD CONSTRAINT "invitations_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" ADD CONSTRAINT "sub_event_responses_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- An invitation's and a response's sub-event is of the same event.
ALTER TABLE "guests"."invitations" ADD CONSTRAINT "invitations_event_sub_event_fk" FOREIGN KEY ("org_id","event_id","sub_event_id") REFERENCES "guests"."sub_events"("org_id","event_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."sub_event_responses" ADD CONSTRAINT "sub_event_responses_event_sub_event_fk" FOREIGN KEY ("org_id","event_id","sub_event_id") REFERENCES "guests"."sub_events"("org_id","event_id","id") ON DELETE cascade;--> statement-breakpoint
-- The venue and the date links clear when the venue or the date goes.
ALTER TABLE "guests"."sub_events" ADD CONSTRAINT "sub_events_venue_fk" FOREIGN KEY ("org_id","venue_id") REFERENCES "venues"."venues"("org_id","id") ON DELETE SET NULL ("venue_id");--> statement-breakpoint
ALTER TABLE "guests"."sub_events" ADD CONSTRAINT "sub_events_occurrence_fk" FOREIGN KEY ("org_id","occurrence_id") REFERENCES "events"."occurrences"("org_id","id") ON DELETE SET NULL ("occurrence_id");
-- hand-written: end
