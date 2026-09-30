CREATE TABLE "tenancy"."agreement_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"accepted_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agreement_acceptances_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "agreement_acceptances_document_check" CHECK (document in ('platform_tos', 'dpa'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."agreement_acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."agreement_acceptances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."legal_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "legal_pages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "legal_pages_kind_check" CHECK (kind in ('terms', 'privacy', 'refund')),
	CONSTRAINT "legal_pages_body_length" CHECK (length(body) between 1 and 50000)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."legal_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."legal_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "tenancy"."agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."legal_pages" ADD CONSTRAINT "legal_pages_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_acceptances_org_id_idx" ON "tenancy"."agreement_acceptances" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_acceptances_org_doc_version_key" ON "tenancy"."agreement_acceptances" USING btree ("org_id","document","version");--> statement-breakpoint
CREATE INDEX "legal_pages_org_id_idx" ON "tenancy"."legal_pages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_pages_org_kind_key" ON "tenancy"."legal_pages" USING btree ("org_id","kind");--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD CONSTRAINT "organizations_brand_color_check" CHECK (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" VALIDATE CONSTRAINT "organizations_brand_color_check";--> statement-breakpoint
CREATE POLICY "agreement_acceptances_tenant_isolation" ON "tenancy"."agreement_acceptances" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "legal_pages_tenant_isolation" ON "tenancy"."legal_pages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));