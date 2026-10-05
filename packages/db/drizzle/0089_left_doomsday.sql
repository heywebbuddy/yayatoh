CREATE SCHEMA "registration";
--> statement-breakpoint
CREATE TABLE "billing"."addons" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"modules" text[] NOT NULL,
	"price_minor" bigint,
	"currency" text,
	"quotas" jsonb NOT NULL,
	CONSTRAINT "addons_kind_check" CHECK (kind in ('event_addon')),
	CONSTRAINT "addons_price_check" CHECK ((price_minor is null) = (currency is null) and (price_minor is null or price_minor >= 0)),
	CONSTRAINT "addons_quotas_check" CHECK (jsonb_typeof(quotas) = 'object')
);
--> statement-breakpoint
CREATE TABLE "billing"."event_addons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"addon_key" text NOT NULL,
	"source" text NOT NULL,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_addons_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_addons_source_check" CHECK (source in ('beta_free', 'purchase', 'override')),
	CONSTRAINT "event_addons_price_check" CHECK (price_minor >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing"."event_addons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."event_addons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."admission_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'admission' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "admission_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "admission_items_kind_check" CHECK (kind in ('admission', 'add_on')),
	CONSTRAINT "admission_items_key_check" CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
	CONSTRAINT "admission_items_name_check" CHECK (length(btrim(name)) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "registration"."admission_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."admission_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."capacity_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_type_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"quantity_held" integer DEFAULT 0 NOT NULL,
	"quantity_sold" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "capacity_claims_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "capacity_claims_quantity_check" CHECK (quantity_held >= 0 and quantity_sold >= 0)
);
--> statement-breakpoint
ALTER TABLE "registration"."capacity_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."capacity_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."registration_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"capacity" integer,
	"quantity_held" integer DEFAULT 0 NOT NULL,
	"quantity_sold" integer DEFAULT 0 NOT NULL,
	"eligibility" text DEFAULT 'open' NOT NULL,
	"access_code" text,
	"email_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "registration_types_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "registration_types_capacity_check" CHECK (quantity_held >= 0 and quantity_sold >= 0 and (capacity is null or (capacity >= 0 and quantity_held + quantity_sold <= capacity))),
	CONSTRAINT "registration_types_key_check" CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
	CONSTRAINT "registration_types_name_check" CHECK (length(btrim(name)) between 1 and 80),
	CONSTRAINT "registration_types_eligibility_check" CHECK (eligibility in ('open', 'access_code', 'email_domain')),
	CONSTRAINT "registration_types_code_check" CHECK ((eligibility = 'access_code') = (access_code is not null) and (access_code is null or access_code ~ '^[A-Z0-9_-]{4,32}$')),
	CONSTRAINT "registration_types_domains_check" CHECK ((eligibility = 'email_domain') = (cardinality(email_domains) > 0) and cardinality(email_domains) <= 20)
);
--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."type_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_type_id" uuid NOT NULL,
	"admission_item_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "type_items_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "registration"."type_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."type_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "managed_by" text;--> statement-breakpoint
ALTER TABLE "billing"."event_addons" ADD CONSTRAINT "event_addons_addon_key_addons_key_fk" FOREIGN KEY ("addon_key") REFERENCES "billing"."addons"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration"."capacity_claims" ADD CONSTRAINT "capacity_claims_type_fk" FOREIGN KEY ("org_id","registration_type_id") REFERENCES "registration"."registration_types"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration"."type_items" ADD CONSTRAINT "type_items_type_fk" FOREIGN KEY ("org_id","registration_type_id") REFERENCES "registration"."registration_types"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration"."type_items" ADD CONSTRAINT "type_items_item_fk" FOREIGN KEY ("org_id","admission_item_id") REFERENCES "registration"."admission_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_addons_org_id_idx" ON "billing"."event_addons" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_addons_org_event_addon_key" ON "billing"."event_addons" USING btree ("org_id","event_id","addon_key");--> statement-breakpoint
CREATE INDEX "admission_items_org_id_idx" ON "registration"."admission_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_items_org_event_key" ON "registration"."admission_items" USING btree ("org_id","event_id","key");--> statement-breakpoint
CREATE INDEX "admission_items_org_event_idx" ON "registration"."admission_items" USING btree ("org_id","event_id","sort_order");--> statement-breakpoint
CREATE INDEX "capacity_claims_org_id_idx" ON "registration"."capacity_claims" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capacity_claims_org_order_key" ON "registration"."capacity_claims" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "capacity_claims_org_type_idx" ON "registration"."capacity_claims" USING btree ("org_id","registration_type_id");--> statement-breakpoint
CREATE INDEX "registration_types_org_id_idx" ON "registration"."registration_types" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_types_org_event_key" ON "registration"."registration_types" USING btree ("org_id","event_id","key");--> statement-breakpoint
CREATE INDEX "registration_types_org_event_idx" ON "registration"."registration_types" USING btree ("org_id","event_id","sort_order");--> statement-breakpoint
CREATE INDEX "type_items_org_id_idx" ON "registration"."type_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "type_items_org_live_cell_key" ON "registration"."type_items" USING btree ("org_id","registration_type_id","admission_item_id") WHERE archived_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "type_items_org_ticket_type_key" ON "registration"."type_items" USING btree ("org_id","ticket_type_id");--> statement-breakpoint
CREATE INDEX "type_items_org_event_idx" ON "registration"."type_items" USING btree ("org_id","event_id");--> statement-breakpoint
-- hand-written: begin (M5.1a: the CHECK on the existing ticket_types table added NOT VALID, then validated)
ALTER TABLE "ticketing"."ticket_types" ADD CONSTRAINT "ticket_types_managed_by_check" CHECK (managed_by is null or managed_by in ('registration')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" VALIDATE CONSTRAINT "ticket_types_managed_by_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "event_addons_tenant_isolation" ON "billing"."event_addons" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "admission_items_tenant_isolation" ON "registration"."admission_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "capacity_claims_tenant_isolation" ON "registration"."capacity_claims" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "registration_types_tenant_isolation" ON "registration"."registration_types" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "type_items_tenant_isolation" ON "registration"."type_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M5.1a / P5-11: the add-on catalog is reference data (app_user reads it only); the conference pack is free in beta (price null) within per-event quotas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON billing.addons FROM app_user;--> statement-breakpoint
INSERT INTO billing.addons (key, name, kind, modules, price_minor, currency, quotas) VALUES
  ('conference_pack', 'Conference pack', 'event_addon', ARRAY['registration','sessions','speakers','exhibitors','sponsors','badges'], NULL, NULL, '{"registrationTypes": 30, "admissionItems": 20, "registrants": 5000}'::jsonb)
  ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
-- M5.1a cross-module composite FKs, down the tiers (registration 5 → orders 4, ticketing 3, events 2); new tables, so no NOT VALID needed.
ALTER TABLE "registration"."registration_types" ADD CONSTRAINT "registration_types_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."admission_items" ADD CONSTRAINT "admission_items_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."type_items" ADD CONSTRAINT "type_items_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."type_items" ADD CONSTRAINT "type_items_ticket_type_fk" FOREIGN KEY ("org_id","ticket_type_id") REFERENCES "ticketing"."ticket_types"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."capacity_claims" ADD CONSTRAINT "capacity_claims_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."capacity_claims" ADD CONSTRAINT "capacity_claims_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE cascade;
-- hand-written: end
