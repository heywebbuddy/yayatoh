CREATE SCHEMA "leads";
--> statement-breakpoint
CREATE TABLE "leads"."exhibitor_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"team_visibility" boolean DEFAULT false NOT NULL,
	"qualifiers" text[] DEFAULT '{}'::text[] NOT NULL,
	"terms_version" integer,
	"terms_accepted_at" timestamp with time zone,
	"terms_accepted_by" uuid,
	CONSTRAINT "exhibitor_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "exhibitor_settings_qualifiers_check" CHECK (cardinality(qualifiers) <= 10),
	CONSTRAINT "exhibitor_settings_terms_check" CHECK ((terms_version is null) = (terms_accepted_at is null) and (terms_version is null) = (terms_accepted_by is null))
);
--> statement-breakpoint
ALTER TABLE "leads"."exhibitor_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads"."exhibitor_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leads"."lead_scans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"scan_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"offline" boolean DEFAULT false NOT NULL,
	"result" text NOT NULL,
	CONSTRAINT "lead_scans_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "lead_scans_scan_id_check" CHECK (scan_id ~ '^[A-Za-z0-9_-]{8,80}$'),
	CONSTRAINT "lead_scans_result_check" CHECK (result in ('captured', 'rescanned'))
);
--> statement-breakpoint
ALTER TABLE "leads"."lead_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads"."lead_scans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leads"."leads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"captured_by" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"last_scanned_at" timestamp with time zone NOT NULL,
	"scans" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"job_title" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"email" text,
	"shared_fields" text[] NOT NULL,
	"email_consent_version" integer,
	"email_withdrawn_at" timestamp with time zone,
	"rating" text,
	"qualifiers" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "leads_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "leads_scans_check" CHECK (scans >= 1),
	CONSTRAINT "leads_name_check" CHECK (char_length(name) <= 200),
	CONSTRAINT "leads_person_check" CHECK (char_length(job_title) <= 200 and char_length(company) <= 200),
	CONSTRAINT "leads_rating_check" CHECK (rating is null or rating in ('hot', 'warm', 'cold')),
	CONSTRAINT "leads_notes_check" CHECK (char_length(notes) <= 2000),
	CONSTRAINT "leads_qualifiers_check" CHECK (cardinality(qualifiers) <= 10),
	CONSTRAINT "leads_shared_fields_check" CHECK (shared_fields <@ array['name', 'job_title', 'company', 'email']::text[]),
	CONSTRAINT "leads_email_check" CHECK ((email is null or ('email' = any(shared_fields) and email_consent_version is not null and email_withdrawn_at is null)))
);
--> statement-breakpoint
ALTER TABLE "leads"."leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads"."leads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads"."lead_scans" ADD CONSTRAINT "lead_scans_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "leads"."leads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exhibitor_settings_org_id_idx" ON "leads"."exhibitor_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exhibitor_settings_org_exhibitor_key" ON "leads"."exhibitor_settings" USING btree ("org_id","exhibitor_id");--> statement-breakpoint
CREATE INDEX "exhibitor_settings_org_event_idx" ON "leads"."exhibitor_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "lead_scans_org_id_idx" ON "leads"."lead_scans" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_scans_org_exhibitor_scan_key" ON "leads"."lead_scans" USING btree ("org_id","exhibitor_id","scan_id");--> statement-breakpoint
CREATE INDEX "lead_scans_org_lead_idx" ON "leads"."lead_scans" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_scans_org_account_idx" ON "leads"."lead_scans" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE INDEX "leads_org_id_idx" ON "leads"."leads" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_exhibitor_ticket_key" ON "leads"."leads" USING btree ("org_id","exhibitor_id","ticket_id");--> statement-breakpoint
CREATE INDEX "leads_org_exhibitor_captured_idx" ON "leads"."leads" USING btree ("org_id","exhibitor_id","captured_at");--> statement-breakpoint
CREATE INDEX "leads_org_event_ticket_idx" ON "leads"."leads" USING btree ("org_id","event_id","ticket_id");--> statement-breakpoint
CREATE POLICY "exhibitor_settings_tenant_isolation" ON "leads"."exhibitor_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "lead_scans_tenant_isolation" ON "leads"."lead_scans" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "leads_tenant_isolation" ON "leads"."leads" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M5.6b cross-module composite FKs (leads is tier 6; events tier 2, program and ticketing tier 3).
-- Settings and leads go with their event and their exhibitor; a lead keeps its ticket (a ticket
-- with leads cannot be deleted; tickets are voided, not deleted).
ALTER TABLE "leads"."exhibitor_settings" ADD CONSTRAINT "exhibitor_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "leads"."exhibitor_settings" ADD CONSTRAINT "exhibitor_settings_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "leads"."leads" ADD CONSTRAINT "leads_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "leads"."leads" ADD CONSTRAINT "leads_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "leads"."leads" ADD CONSTRAINT "leads_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id");--> statement-breakpoint
ALTER TABLE "leads"."lead_scans" ADD CONSTRAINT "lead_scans_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "leads"."lead_scans" ADD CONSTRAINT "lead_scans_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade;
-- hand-written: end
