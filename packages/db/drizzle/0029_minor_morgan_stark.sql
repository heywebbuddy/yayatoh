CREATE TABLE "tenancy"."org_suspensions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" text,
	CONSTRAINT "org_suspensions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_suspensions_kind_check" CHECK (kind in ('pause_checkout', 'pause_publishing', 'pause_messaging')),
	CONSTRAINT "org_suspensions_reason_length" CHECK (length(reason) between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."org_suspensions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."org_suspensions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."payment_accounts" ADD COLUMN "payouts_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments"."payment_accounts" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "tenancy"."org_suspensions" ADD CONSTRAINT "org_suspensions_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_suspensions_org_id_idx" ON "tenancy"."org_suspensions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_suspensions_org_kind_active_key" ON "tenancy"."org_suspensions" USING btree ("org_id","kind") WHERE lifted_at is null;--> statement-breakpoint
CREATE POLICY "org_suspensions_tenant_isolation" ON "tenancy"."org_suspensions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));