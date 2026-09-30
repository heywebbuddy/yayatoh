CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE SCHEMA "tenancy";
--> statement-breakpoint
CREATE TABLE "platform"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text NOT NULL,
	CONSTRAINT "audit_events_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "platform"."audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."domain_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" text NOT NULL,
	"request_id" text NOT NULL,
	"log_seq" bigint,
	"published_at" timestamp with time zone,
	CONSTRAINT "domain_events_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "platform"."domain_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."domain_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	CONSTRAINT "idempotency_keys_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "idempotency_keys_key_length" CHECK (length("platform"."idempotency_keys"."key") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "platform"."idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."idempotency_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."processed_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "processed_events_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "platform"."processed_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."processed_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."entitlement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"module_key" text NOT NULL,
	"effect" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "entitlement_overrides_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "entitlement_overrides_effect_check" CHECK (effect in ('grant', 'revoke'))
);
--> statement-breakpoint
ALTER TABLE "billing"."entitlement_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."entitlement_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."org_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_plans_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "billing"."org_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."org_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."plan_modules" (
	"plan_key" text NOT NULL,
	"module_key" text NOT NULL,
	CONSTRAINT "plan_modules_plan_key_module_key_pk" PRIMARY KEY("plan_key","module_key")
);
--> statement-breakpoint
CREATE TABLE "billing"."plans" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "memberships_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "memberships_role_check" CHECK (role in ('owner', 'admin', 'manager', 'finance', 'marketing', 'box_office', 'scanner', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'organizer' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"default_profile" text DEFAULT 'other' NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"powered_by_visible" boolean DEFAULT true NOT NULL,
	"legacy_instance" text,
	CONSTRAINT "organizations_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "organizations_org_is_self" CHECK (org_id = id),
	CONSTRAINT "organizations_kind_check" CHECK (kind in ('organizer', 'agency', 'venue', 'platform')),
	CONSTRAINT "organizations_status_check" CHECK (status in ('active', 'limited', 'suspended', 'terminated')),
	CONSTRAINT "organizations_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."org_plans" ADD CONSTRAINT "org_plans_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "billing"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."plan_modules" ADD CONSTRAINT "plan_modules_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "billing"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_id_idx" ON "platform"."audit_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_id_created_at_idx" ON "platform"."audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "domain_events_org_id_idx" ON "platform"."domain_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_log_seq_key" ON "platform"."domain_events" USING btree ("log_seq");--> statement-breakpoint
CREATE INDEX "domain_events_org_id_log_seq_idx" ON "platform"."domain_events" USING btree ("org_id","log_seq");--> statement-breakpoint
CREATE INDEX "domain_events_unpublished_idx" ON "platform"."domain_events" USING btree ("org_id","id") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "idempotency_keys_org_id_idx" ON "platform"."idempotency_keys" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_org_scope_key_key" ON "platform"."idempotency_keys" USING btree ("org_id","scope","key");--> statement-breakpoint
CREATE INDEX "processed_events_org_id_idx" ON "platform"."processed_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_events_org_consumer_event_key" ON "platform"."processed_events" USING btree ("org_id","consumer","event_id");--> statement-breakpoint
CREATE INDEX "entitlement_overrides_org_id_idx" ON "billing"."entitlement_overrides" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_overrides_org_module_key" ON "billing"."entitlement_overrides" USING btree ("org_id","module_key");--> statement-breakpoint
CREATE INDEX "org_plans_org_id_idx" ON "billing"."org_plans" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_plans_org_key" ON "billing"."org_plans" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "memberships_org_id_idx" ON "tenancy"."memberships" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_key" ON "tenancy"."memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "organizations_org_id_idx" ON "tenancy"."organizations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "tenancy"."organizations" USING btree (slug);--> statement-breakpoint
CREATE POLICY "audit_events_tenant_isolation" ON "platform"."audit_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "domain_events_tenant_isolation" ON "platform"."domain_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "idempotency_keys_tenant_isolation" ON "platform"."idempotency_keys" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "processed_events_tenant_isolation" ON "platform"."processed_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "entitlement_overrides_tenant_isolation" ON "billing"."entitlement_overrides" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "org_plans_tenant_isolation" ON "billing"."org_plans" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "tenancy"."memberships" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "organizations_tenant_isolation" ON "tenancy"."organizations" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));