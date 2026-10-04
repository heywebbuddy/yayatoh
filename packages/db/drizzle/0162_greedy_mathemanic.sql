CREATE SCHEMA "ce";
--> statement-breakpoint
CREATE TABLE "ce"."awards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"in_person_minutes" integer NOT NULL,
	"virtual_minutes" integer NOT NULL,
	"minutes" integer NOT NULL,
	"credits" integer NOT NULL,
	CONSTRAINT "awards_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "awards_minutes_check" CHECK (in_person_minutes >= 0 and virtual_minutes >= 0 and minutes > 0 and credits > 0)
);
--> statement-breakpoint
ALTER TABLE "ce"."awards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ce"."awards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ce"."certificates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"code" text NOT NULL,
	"holder_name" text NOT NULL,
	"holder_email" text NOT NULL,
	"locale" text NOT NULL,
	"total_credits" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"revised_at" timestamp with time zone NOT NULL,
	"copy_version" text NOT NULL,
	CONSTRAINT "certificates_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "certificates_code_check" CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$'),
	CONSTRAINT "certificates_status_check" CHECK (status in ('issued', 'revoked')),
	CONSTRAINT "certificates_total_check" CHECK (total_credits >= 0),
	CONSTRAINT "certificates_revision_check" CHECK (revision >= 1),
	CONSTRAINT "certificates_hash_check" CHECK (content_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "certificates_locale_check" CHECK (char_length(locale) between 2 and 10)
);
--> statement-breakpoint
ALTER TABLE "ce"."certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ce"."certificates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ce"."session_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"credits" integer NOT NULL,
	"min_minutes" integer NOT NULL,
	"count_in_person" boolean NOT NULL,
	"count_virtual" boolean NOT NULL,
	CONSTRAINT "session_rules_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "session_rules_credits_check" CHECK (credits between 1 and 10000),
	CONSTRAINT "session_rules_min_minutes_check" CHECK (min_minutes between 1 and 1440),
	CONSTRAINT "session_rules_counts_check" CHECK (count_in_person or count_virtual)
);
--> statement-breakpoint
ALTER TABLE "ce"."session_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ce"."session_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ce"."settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"credit_label" text,
	"accreditor" text,
	"calculated_at" timestamp with time zone,
	CONSTRAINT "settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "settings_credit_label_check" CHECK (credit_label is null or char_length(credit_label) between 1 and 60),
	CONSTRAINT "settings_accreditor_check" CHECK (accreditor is null or char_length(accreditor) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "ce"."settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ce"."settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "virtual"."zoom_attendance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"webinar_link_id" uuid NOT NULL,
	"ticket_id" uuid,
	"email" text,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone NOT NULL,
	CONSTRAINT "zoom_attendance_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "zoom_attendance_times_check" CHECK (left_at >= joined_at),
	CONSTRAINT "zoom_attendance_email_check" CHECK (email is null or char_length(email) <= 320)
);
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_attendance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "virtual"."zoom_registrants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"webinar_link_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	CONSTRAINT "zoom_registrants_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "zoom_registrants_email_check" CHECK (char_length(email) between 3 and 320 and email = lower(email)),
	CONSTRAINT "zoom_registrants_names_check" CHECK (char_length(first_name) between 1 and 64 and char_length(last_name) <= 64)
);
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_registrants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_registrants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "virtual"."zoom_webinars" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"webinar_id" text NOT NULL,
	CONSTRAINT "zoom_webinars_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "zoom_webinars_webinar_id_check" CHECK (webinar_id ~ '^[0-9]{9,12}$')
);
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_webinars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_webinars" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ce"."awards" ADD CONSTRAINT "awards_certificate_fk" FOREIGN KEY ("org_id","certificate_id") REFERENCES "ce"."certificates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_attendance" ADD CONSTRAINT "zoom_attendance_webinar_fk" FOREIGN KEY ("org_id","webinar_link_id") REFERENCES "virtual"."zoom_webinars"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual"."zoom_registrants" ADD CONSTRAINT "zoom_registrants_webinar_fk" FOREIGN KEY ("org_id","webinar_link_id") REFERENCES "virtual"."zoom_webinars"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "awards_org_id_idx" ON "ce"."awards" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "awards_org_session_ticket_key" ON "ce"."awards" USING btree ("org_id","session_id","ticket_id");--> statement-breakpoint
CREATE INDEX "awards_org_certificate_idx" ON "ce"."awards" USING btree ("org_id","certificate_id");--> statement-breakpoint
CREATE INDEX "awards_org_event_idx" ON "ce"."awards" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "certificates_org_id_idx" ON "ce"."certificates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_org_ticket_key" ON "ce"."certificates" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_org_code_key" ON "ce"."certificates" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "certificates_org_event_idx" ON "ce"."certificates" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "session_rules_org_id_idx" ON "ce"."session_rules" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_rules_org_session_key" ON "ce"."session_rules" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE INDEX "session_rules_org_event_idx" ON "ce"."session_rules" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "settings_org_id_idx" ON "ce"."settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_org_event_key" ON "ce"."settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "zoom_attendance_org_id_idx" ON "virtual"."zoom_attendance" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "zoom_attendance_org_event_idx" ON "virtual"."zoom_attendance" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "zoom_attendance_org_ticket_idx" ON "virtual"."zoom_attendance" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE INDEX "zoom_registrants_org_id_idx" ON "virtual"."zoom_registrants" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zoom_registrants_org_session_ticket_key" ON "virtual"."zoom_registrants" USING btree ("org_id","session_id","ticket_id");--> statement-breakpoint
CREATE INDEX "zoom_registrants_org_updated_idx" ON "virtual"."zoom_registrants" USING btree ("org_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "zoom_registrants_org_webinar_email_idx" ON "virtual"."zoom_registrants" USING btree ("org_id","webinar_link_id","email");--> statement-breakpoint
CREATE INDEX "zoom_registrants_org_ticket_idx" ON "virtual"."zoom_registrants" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE INDEX "zoom_webinars_org_id_idx" ON "virtual"."zoom_webinars" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zoom_webinars_org_session_key" ON "virtual"."zoom_webinars" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zoom_webinars_org_webinar_key" ON "virtual"."zoom_webinars" USING btree ("org_id","webinar_id");--> statement-breakpoint
CREATE INDEX "zoom_webinars_org_event_idx" ON "virtual"."zoom_webinars" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "awards_tenant_isolation" ON "ce"."awards" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "certificates_tenant_isolation" ON "ce"."certificates" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_rules_tenant_isolation" ON "ce"."session_rules" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "settings_tenant_isolation" ON "ce"."settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "zoom_attendance_tenant_isolation" ON "virtual"."zoom_attendance" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "zoom_registrants_tenant_isolation" ON "virtual"."zoom_registrants" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "zoom_webinars_tenant_isolation" ON "virtual"."zoom_webinars" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.9b cross-module FKs, down the tiers (virtual 4 and ce 5 → events 2, ticketing 3, program 3);
-- new tables, so no NOT VALID needed. Deleting an event, session or ticket removes its Zoom link,
-- registrants, attendance, CE rules, certificates and awards with it.
ALTER TABLE "virtual"."zoom_webinars" ADD CONSTRAINT "zoom_webinars_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_webinars" ADD CONSTRAINT "zoom_webinars_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_registrants" ADD CONSTRAINT "zoom_registrants_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "virtual"."zoom_attendance" ADD CONSTRAINT "zoom_attendance_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE SET NULL ("ticket_id");
--> statement-breakpoint
ALTER TABLE "ce"."settings" ADD CONSTRAINT "settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ce"."session_rules" ADD CONSTRAINT "session_rules_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ce"."session_rules" ADD CONSTRAINT "session_rules_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ce"."certificates" ADD CONSTRAINT "certificates_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ce"."certificates" ADD CONSTRAINT "certificates_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ce"."awards" ADD CONSTRAINT "awards_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;
-- hand-written: end
