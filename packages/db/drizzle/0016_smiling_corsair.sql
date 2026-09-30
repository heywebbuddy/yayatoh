CREATE SCHEMA "forms";
--> statement-breakpoint
CREATE TABLE "forms"."form_responses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_version_id" uuid NOT NULL,
	"respondent_type" text NOT NULL,
	"respondent_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"sensitive_ciphertext" text,
	CONSTRAINT "form_responses_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "form_responses_respondent_type_check" CHECK (respondent_type in ('order'))
);
--> statement-breakpoint
ALTER TABLE "forms"."form_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."form_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "forms"."form_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	CONSTRAINT "form_versions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "form_versions_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "forms"."form_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."form_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "forms"."forms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "forms_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "forms_kind_check" CHECK (kind in ('checkout_questions')),
	CONSTRAINT "forms_subject_type_check" CHECK (subject_type in ('event'))
);
--> statement-breakpoint
ALTER TABLE "forms"."forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."forms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms"."form_responses" ADD CONSTRAINT "form_responses_version_fk" FOREIGN KEY ("org_id","form_version_id") REFERENCES "forms"."form_versions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_versions" ADD CONSTRAINT "form_versions_form_fk" FOREIGN KEY ("org_id","form_id") REFERENCES "forms"."forms"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_responses_org_id_idx" ON "forms"."form_responses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_responses_org_version_respondent_key" ON "forms"."form_responses" USING btree ("org_id","form_version_id","respondent_type","respondent_id");--> statement-breakpoint
CREATE INDEX "form_responses_org_respondent_idx" ON "forms"."form_responses" USING btree ("org_id","respondent_type","respondent_id");--> statement-breakpoint
CREATE INDEX "form_versions_org_id_idx" ON "forms"."form_versions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_org_form_version_key" ON "forms"."form_versions" USING btree ("org_id","form_id","version");--> statement-breakpoint
CREATE INDEX "forms_org_id_idx" ON "forms"."forms" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_org_kind_subject_key" ON "forms"."forms" USING btree ("org_id","kind","subject_type","subject_id");--> statement-breakpoint
CREATE POLICY "form_responses_tenant_isolation" ON "forms"."form_responses" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "form_versions_tenant_isolation" ON "forms"."form_versions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "forms_tenant_isolation" ON "forms"."forms" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));