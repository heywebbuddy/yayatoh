CREATE TABLE "guests"."collector_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "collector_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "collector_settings_code_check" CHECK (code ~ '^[0-9A-Z_]{8,40}$')
);
--> statement-breakpoint
ALTER TABLE "guests"."collector_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."collector_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."collector_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload_ciphertext" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"party_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "collector_submissions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "collector_submissions_status_check" CHECK (status in ('pending', 'approved', 'merged', 'rejected')),
	CONSTRAINT "collector_submissions_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "collector_submissions_decided_check" CHECK ((status = 'pending') = (decided_at is null) and (status = 'pending' or payload_ciphertext is null))
);
--> statement-breakpoint
ALTER TABLE "guests"."collector_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."collector_submissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."invitation_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"sms_text" text NOT NULL,
	CONSTRAINT "invitation_templates_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "invitation_templates_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "invitation_templates_subject_length" CHECK (length(subject) between 1 and 150),
	CONSTRAINT "invitation_templates_message_length" CHECK (length(message) between 1 and 2000),
	CONSTRAINT "invitation_templates_sms_length" CHECK (length(sms_text) between 1 and 320)
);
--> statement-breakpoint
ALTER TABLE "guests"."invitation_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."invitation_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."invite_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"party_id" uuid,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"locale" text NOT NULL,
	"sent_by" uuid,
	CONSTRAINT "invite_messages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "invite_messages_kind_check" CHECK (kind in ('invitation', 'reminder', 'test')),
	CONSTRAINT "invite_messages_channel_check" CHECK (channel in ('email', 'sms')),
	CONSTRAINT "invite_messages_party_check" CHECK ((kind = 'test') = (party_id is null)),
	CONSTRAINT "invite_messages_key_length" CHECK (length(dedupe_key) between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "guests"."invite_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."invite_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."party_invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	CONSTRAINT "party_invites_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "party_invites_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
--> statement-breakpoint
ALTER TABLE "guests"."party_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."party_invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" DROP CONSTRAINT "journey_runs_trigger_check";--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" DROP CONSTRAINT "journey_steps_anchor_check";--> statement-breakpoint
ALTER TABLE "automations"."journeys" DROP CONSTRAINT "journeys_trigger_check";--> statement-breakpoint
ALTER TABLE "automations"."journeys" DROP CONSTRAINT "journeys_template_check";--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" DROP CONSTRAINT "rsvp_history_action_check";--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "automations"."scheduled_actions" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "automations"."scheduled_actions" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "guests"."invite_messages" ADD CONSTRAINT "invite_messages_party_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "guests"."parties"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests"."party_invites" ADD CONSTRAINT "party_invites_party_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "guests"."parties"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collector_settings_org_id_idx" ON "guests"."collector_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collector_settings_org_event_key" ON "guests"."collector_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collector_settings_code_key" ON "guests"."collector_settings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "collector_submissions_org_id_idx" ON "guests"."collector_submissions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "collector_submissions_org_event_idx" ON "guests"."collector_submissions" USING btree ("org_id","event_id","status","created_at");--> statement-breakpoint
CREATE INDEX "invitation_templates_org_id_idx" ON "guests"."invitation_templates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_templates_org_event_locale_key" ON "guests"."invitation_templates" USING btree ("org_id","event_id","locale");--> statement-breakpoint
CREATE INDEX "invite_messages_org_id_idx" ON "guests"."invite_messages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_messages_org_channel_key" ON "guests"."invite_messages" USING btree ("org_id","channel","dedupe_key");--> statement-breakpoint
CREATE INDEX "invite_messages_org_party_idx" ON "guests"."invite_messages" USING btree ("org_id","party_id","created_at");--> statement-breakpoint
CREATE INDEX "invite_messages_org_event_idx" ON "guests"."invite_messages" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "party_invites_org_id_idx" ON "guests"."party_invites" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_invites_org_party_key" ON "guests"."party_invites" USING btree ("org_id","party_id");--> statement-breakpoint
CREATE INDEX "party_invites_org_event_idx" ON "guests"."party_invites" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_runs_org_journey_event_party_key" ON "automations"."journey_runs" USING btree ("org_id","journey_id","event_id","party_id") WHERE party_id is not null;--> statement-breakpoint
CREATE INDEX "journey_runs_org_party_idx" ON "automations"."journey_runs" USING btree ("org_id","party_id") WHERE party_id is not null;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" ADD CONSTRAINT "journey_runs_subject_check" CHECK ((contact_id is null) <> (party_id is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" VALIDATE CONSTRAINT "journey_runs_subject_check";--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" ADD CONSTRAINT "journey_runs_trigger_check" CHECK (trigger in ('order_paid', 'checked_in', 'event_time', 'rsvp_sent')) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" VALIDATE CONSTRAINT "journey_runs_trigger_check";--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" ADD CONSTRAINT "journey_steps_anchor_check" CHECK (anchor in ('trigger', 'event_start', 'event_end', 'rsvp_deadline')) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" VALIDATE CONSTRAINT "journey_steps_anchor_check";--> statement-breakpoint
ALTER TABLE "automations"."journeys" ADD CONSTRAINT "journeys_trigger_check" CHECK (trigger in ('order_paid', 'checked_in', 'event_time', 'rsvp_sent')) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journeys" VALIDATE CONSTRAINT "journeys_trigger_check";--> statement-breakpoint
ALTER TABLE "automations"."journeys" ADD CONSTRAINT "journeys_template_check" CHECK (template is null or template in ('vision', 'rsvp_reminders')) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journeys" VALIDATE CONSTRAINT "journeys_template_check";--> statement-breakpoint
ALTER TABLE "automations"."scheduled_actions" ADD CONSTRAINT "scheduled_actions_subject_check" CHECK ((contact_id is null) <> (party_id is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."scheduled_actions" VALIDATE CONSTRAINT "scheduled_actions_subject_check";--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" ADD CONSTRAINT "rsvp_history_action_check" CHECK (action in ('party_created', 'party_updated', 'party_removed', 'guest_added', 'guest_updated', 'guest_removed', 'guest_moved', 'plus_one_added', 'plus_one_named', 'sub_event_created', 'sub_event_updated', 'sub_event_moved', 'sub_event_removed', 'invitation_added', 'invitation_removed', 'response_recorded', 'response_cleared', 'rsvp_link_created', 'rsvp_link_reset', 'rsvp_pin_reset', 'rsvp_sent', 'rsvp_viewed', 'rsvp_submitted', 'rsvp_reopened', 'invitation_sent', 'collector_approved', 'collector_merged')) NOT VALID;--> statement-breakpoint
ALTER TABLE "guests"."rsvp_history" VALIDATE CONSTRAINT "rsvp_history_action_check";--> statement-breakpoint
CREATE POLICY "collector_settings_tenant_isolation" ON "guests"."collector_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "collector_submissions_tenant_isolation" ON "guests"."collector_submissions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "invitation_templates_tenant_isolation" ON "guests"."invitation_templates" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "invite_messages_tenant_isolation" ON "guests"."invite_messages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "party_invites_tenant_isolation" ON "guests"."party_invites" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.1f cross-module composite FKs (guests is tier 3, events tier 2): the collector, its
-- submissions, the invitation wording, party languages and the message log belong to one event
-- of the org; the event takes them with it. A decided submission keeps its row (status, dates)
-- when its party goes: only the link clears.
ALTER TABLE "guests"."collector_settings" ADD CONSTRAINT "collector_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."collector_submissions" ADD CONSTRAINT "collector_submissions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."collector_submissions" ADD CONSTRAINT "collector_submissions_party_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "guests"."parties"("org_id","id") ON DELETE SET NULL ("party_id");--> statement-breakpoint
ALTER TABLE "guests"."invitation_templates" ADD CONSTRAINT "invitation_templates_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."party_invites" ADD CONSTRAINT "party_invites_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."invite_messages" ADD CONSTRAINT "invite_messages_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The contact collector's address: code → org and event, only while the host keeps the
-- collector on and the org is live. Ids only; nothing about the guests or the submissions.
CREATE FUNCTION guests.collector_target(p_code text)
RETURNS TABLE (org_id uuid, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT c.org_id, c.event_id FROM guests.collector_settings c
  JOIN tenancy.organizations o ON o.id = c.org_id AND o.status IN ('active', 'limited')
  WHERE c.code = p_code AND c.enabled
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION guests.collector_target(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION guests.collector_target(text) TO app_user;
-- hand-written: end
