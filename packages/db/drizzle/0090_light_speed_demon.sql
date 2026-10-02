CREATE TABLE "forms"."companies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"respondents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "companies_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "companies_name_check" CHECK (char_length(name) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "forms"."companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."companies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "forms"."job_titles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "job_titles_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "job_titles_label_check" CHECK (char_length(label) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "forms"."job_titles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."job_titles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "forms"."respondents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"registration_type_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"locale" text NOT NULL,
	"page_key" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensitive_ciphertext" text,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"resume_sends" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "respondents_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "respondents_type_check" CHECK (registration_type_id ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "respondents_resume_sends_check" CHECK (resume_sends >= 0)
);
--> statement-breakpoint
ALTER TABLE "forms"."respondents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."respondents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."consents" ADD COLUMN "version" integer;--> statement-breakpoint
ALTER TABLE "forms"."respondents" ADD CONSTRAINT "respondents_form_fk" FOREIGN KEY ("org_id","form_id") REFERENCES "forms"."forms"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."respondents" ADD CONSTRAINT "respondents_version_fk" FOREIGN KEY ("org_id","form_version_id") REFERENCES "forms"."form_versions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_org_id_idx" ON "forms"."companies" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_org_name_norm_key" ON "forms"."companies" USING btree ("org_id","name_norm");--> statement-breakpoint
CREATE INDEX "job_titles_org_id_idx" ON "forms"."job_titles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_titles_org_label_key" ON "forms"."job_titles" USING btree ("org_id","label");--> statement-breakpoint
CREATE INDEX "respondents_org_id_idx" ON "forms"."respondents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "respondents_org_form_idx" ON "forms"."respondents" USING btree ("org_id","form_id");--> statement-breakpoint
CREATE INDEX "respondents_org_expires_idx" ON "forms"."respondents" USING btree ("org_id","expires_at");--> statement-breakpoint
-- hand-written: begin
-- Widened CHECKs on existing tables (M5.1b: the registration form kind, its respondents, the exhibitor-sharing consent purpose and consent versions): NOT VALID + VALIDATE keeps the locks short.
ALTER TABLE "crm"."consents" DROP CONSTRAINT "consents_purpose_check";--> statement-breakpoint
ALTER TABLE "crm"."contacts" DROP CONSTRAINT "contacts_source_check";--> statement-breakpoint
ALTER TABLE "forms"."form_responses" DROP CONSTRAINT "form_responses_respondent_type_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" DROP CONSTRAINT "forms_kind_check";--> statement-breakpoint
ALTER TABLE "crm"."consents" ADD CONSTRAINT "consents_version_check" CHECK (version is null or version >= 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."consents" VALIDATE CONSTRAINT "consents_version_check";--> statement-breakpoint
ALTER TABLE "crm"."consents" ADD CONSTRAINT "consents_purpose_check" CHECK (purpose in ('marketing', 'informational', 'exhibitor_sharing')) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."consents" VALIDATE CONSTRAINT "consents_purpose_check";--> statement-breakpoint
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_source_check" CHECK (source in ('checkout', 'ticket', 'import', 'manual', 'legacy', 'registration')) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."contacts" VALIDATE CONSTRAINT "contacts_source_check";--> statement-breakpoint
ALTER TABLE "forms"."form_responses" ADD CONSTRAINT "form_responses_respondent_type_check" CHECK (respondent_type in ('order', 'survey_invitation', 'form_respondent')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."form_responses" VALIDATE CONSTRAINT "form_responses_respondent_type_check";--> statement-breakpoint
ALTER TABLE "forms"."forms" ADD CONSTRAINT "forms_kind_check" CHECK (kind in ('checkout_questions', 'survey', 'registration')) NOT VALID;--> statement-breakpoint
ALTER TABLE "forms"."forms" VALIDATE CONSTRAINT "forms_kind_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "companies_tenant_isolation" ON "forms"."companies" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "job_titles_tenant_isolation" ON "forms"."job_titles" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "respondents_tenant_isolation" ON "forms"."respondents" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Registration form links (M5.1b): respondent id (from a verified HMAC token) → its org. Ids only.
-- Only live orgs (M1.3f, like surveys.invitation_org): a suspended or terminated org's links are not found.
CREATE FUNCTION forms.respondent_org(p_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT r.org_id FROM forms.respondents r
  JOIN tenancy.organizations o ON o.id = r.org_id AND o.status IN ('active', 'limited')
  WHERE r.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forms.respondent_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forms.respondent_org(uuid) TO app_user;
-- hand-written: end
