CREATE TABLE "tenancy"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "invitations_role_check" CHECK (role in ('owner', 'admin', 'manager', 'finance', 'marketing', 'box_office', 'scanner', 'viewer')),
	CONSTRAINT "invitations_email_lower_check" CHECK (email = lower(email))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."invitations" ADD CONSTRAINT "invitations_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_org_id_idx" ON "tenancy"."invitations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_org_email_pending_key" ON "tenancy"."invitations" USING btree ("org_id","email") WHERE accepted_at is null and revoked_at is null;--> statement-breakpoint
CREATE POLICY "invitations_tenant_isolation" ON "tenancy"."invitations" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));