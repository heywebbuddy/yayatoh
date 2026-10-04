CREATE TABLE "orders"."addon_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_face_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "addon_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "addon_items_kind_check" CHECK (kind in ('sponsor_package', 'lead_licenses')),
	CONSTRAINT "addon_items_quantity_check" CHECK (quantity between 1 and 100),
	CONSTRAINT "addon_items_amount_check" CHECK (unit_face_minor >= 1 and fee_minor >= 0),
	CONSTRAINT "addon_items_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "addon_items_name_check" CHECK (char_length(name) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "orders"."addon_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."addon_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."lead_license_purchases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"order_id" uuid,
	"hold_until" timestamp with time zone,
	"activated_at" timestamp with time zone,
	CONSTRAINT "lead_license_purchases_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "lead_license_purchases_quantity_check" CHECK (quantity between 1 and 100),
	CONSTRAINT "lead_license_purchases_price_check" CHECK (unit_price_minor >= 1),
	CONSTRAINT "lead_license_purchases_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "lead_license_purchases_status_check" CHECK (status in ('pending', 'active', 'cancelled')),
	CONSTRAINT "lead_license_purchases_active_check" CHECK (status <> 'active' or activated_at is not null)
);
--> statement-breakpoint
ALTER TABLE "program"."lead_license_purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."lead_license_purchases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."lead_licenses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "lead_licenses_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "program"."lead_licenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."lead_licenses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sponsor_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"owner" text NOT NULL,
	"owner_name" text,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"from_package" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sponsor_deliverables_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sponsor_deliverables_title_check" CHECK (char_length(title) between 1 and 120),
	CONSTRAINT "sponsor_deliverables_owner_check" CHECK (owner in ('sponsor', 'organizer')),
	CONSTRAINT "sponsor_deliverables_owner_name_check" CHECK (owner_name is null or char_length(owner_name) between 1 and 80),
	CONSTRAINT "sponsor_deliverables_status_check" CHECK (status in ('open', 'done')),
	CONSTRAINT "sponsor_deliverables_done_check" CHECK ((status = 'done') = (completed_at is not null)),
	CONSTRAINT "sponsor_deliverables_completed_by_check" CHECK (completed_by is null or completed_by in ('organizer', 'sponsor'))
);
--> statement-breakpoint
ALTER TABLE "program"."sponsor_deliverables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sponsor_deliverables" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sponsor_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"order_id" uuid,
	"hold_until" timestamp with time zone,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"comp_registrations" integer NOT NULL,
	"exhibitor_badges" integer NOT NULL,
	"lead_licenses" integer NOT NULL,
	"logo_placements" text[] DEFAULT '{}'::text[] NOT NULL,
	"session_slots" integer NOT NULL,
	"activated_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"granted_by" text NOT NULL,
	"note" text,
	"comp_code" text,
	"comp_promo_code_id" uuid,
	CONSTRAINT "sponsor_grants_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sponsor_grants_status_check" CHECK (status in ('pending', 'active', 'cancelled')),
	CONSTRAINT "sponsor_grants_source_check" CHECK (source in ('purchase', 'organizer')),
	CONSTRAINT "sponsor_grants_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "sponsor_grants_price_check" CHECK (price_minor >= 0),
	CONSTRAINT "sponsor_grants_allowances_check" CHECK (comp_registrations between 0 and 500 and exhibitor_badges between 0 and 500 and lead_licenses between 0 and 500 and session_slots between 0 and 20),
	CONSTRAINT "sponsor_grants_active_check" CHECK (status <> 'active' or activated_at is not null),
	CONSTRAINT "sponsor_grants_pending_check" CHECK (status <> 'pending' or hold_until is not null),
	CONSTRAINT "sponsor_grants_note_check" CHECK (note is null or char_length(note) <= 500),
	CONSTRAINT "sponsor_grants_comp_code_check" CHECK (comp_code is null or comp_code ~ '^[A-Z0-9_-]{3,32}$')
);
--> statement-breakpoint
ALTER TABLE "program"."sponsor_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sponsor_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sponsor_packages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_minor" bigint,
	"currency" text NOT NULL,
	"quantity" integer,
	"on_sale" boolean DEFAULT false NOT NULL,
	"comp_registrations" integer DEFAULT 0 NOT NULL,
	"exhibitor_badges" integer DEFAULT 0 NOT NULL,
	"lead_licenses" integer DEFAULT 0 NOT NULL,
	"logo_placements" text[] DEFAULT '{}'::text[] NOT NULL,
	"session_slots" integer DEFAULT 0 NOT NULL,
	"deliverables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "sponsor_packages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sponsor_packages_description_check" CHECK (char_length(description) <= 1000),
	CONSTRAINT "sponsor_packages_price_check" CHECK (price_minor is null or price_minor between 1 and 100000000000),
	CONSTRAINT "sponsor_packages_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "sponsor_packages_quantity_check" CHECK (quantity is null or quantity between 1 and 999),
	CONSTRAINT "sponsor_packages_on_sale_check" CHECK (not on_sale or price_minor is not null),
	CONSTRAINT "sponsor_packages_allowances_check" CHECK (comp_registrations between 0 and 500 and exhibitor_badges between 0 and 500 and lead_licenses between 0 and 500 and session_slots between 0 and 20),
	CONSTRAINT "sponsor_packages_placements_check" CHECK (cardinality(logo_placements) <= 6 and logo_placements <@ array['website', 'agenda', 'badges', 'signage', 'stage', 'emails']::text[]),
	CONSTRAINT "sponsor_packages_deliverables_check" CHECK (jsonb_typeof(deliverables) = 'array')
);
--> statement-breakpoint
ALTER TABLE "program"."sponsor_packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sponsor_packages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sponsor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"exhibitor_id" uuid,
	CONSTRAINT "sponsor_profiles_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "program"."sponsor_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sponsor_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sponsored_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	CONSTRAINT "sponsored_sessions_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "program"."sponsored_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sponsored_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_settings" ADD COLUMN "included_lead_licenses" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_settings" ADD COLUMN "lead_license_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders"."addon_items" ADD CONSTRAINT "addon_items_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."lead_license_purchases" ADD CONSTRAINT "lead_license_purchases_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."lead_licenses" ADD CONSTRAINT "lead_licenses_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sponsor_deliverables" ADD CONSTRAINT "sponsor_deliverables_sponsor_fk" FOREIGN KEY ("org_id","sponsor_id") REFERENCES "program"."sponsors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sponsor_grants" ADD CONSTRAINT "sponsor_grants_sponsor_fk" FOREIGN KEY ("org_id","sponsor_id") REFERENCES "program"."sponsors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sponsor_grants" ADD CONSTRAINT "sponsor_grants_tier_fk" FOREIGN KEY ("org_id","tier_id") REFERENCES "program"."sponsor_tiers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sponsor_packages" ADD CONSTRAINT "sponsor_packages_tier_fk" FOREIGN KEY ("org_id","tier_id") REFERENCES "program"."sponsor_tiers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sponsor_profiles" ADD CONSTRAINT "sponsor_profiles_sponsor_fk" FOREIGN KEY ("org_id","sponsor_id") REFERENCES "program"."sponsors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sponsored_sessions" ADD CONSTRAINT "sponsored_sessions_sponsor_fk" FOREIGN KEY ("org_id","sponsor_id") REFERENCES "program"."sponsors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."sponsored_sessions" ADD CONSTRAINT "sponsored_sessions_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addon_items_org_id_idx" ON "orders"."addon_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addon_items_org_order_key" ON "orders"."addon_items" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addon_items_org_ref_key" ON "orders"."addon_items" USING btree ("org_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "lead_license_purchases_org_id_idx" ON "program"."lead_license_purchases" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_license_purchases_org_order_key" ON "program"."lead_license_purchases" USING btree ("org_id","order_id") WHERE order_id is not null;--> statement-breakpoint
CREATE INDEX "lead_license_purchases_org_exhibitor_idx" ON "program"."lead_license_purchases" USING btree ("org_id","exhibitor_id","status");--> statement-breakpoint
CREATE INDEX "lead_licenses_org_id_idx" ON "program"."lead_licenses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_licenses_org_account_key" ON "program"."lead_licenses" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE INDEX "lead_licenses_org_exhibitor_idx" ON "program"."lead_licenses" USING btree ("org_id","exhibitor_id");--> statement-breakpoint
CREATE INDEX "sponsor_deliverables_org_id_idx" ON "program"."sponsor_deliverables" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sponsor_deliverables_org_event_due_idx" ON "program"."sponsor_deliverables" USING btree ("org_id","event_id","status","due_at");--> statement-breakpoint
CREATE INDEX "sponsor_deliverables_org_sponsor_idx" ON "program"."sponsor_deliverables" USING btree ("org_id","sponsor_id");--> statement-breakpoint
CREATE INDEX "sponsor_grants_org_id_idx" ON "program"."sponsor_grants" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_grants_org_active_key" ON "program"."sponsor_grants" USING btree ("org_id","sponsor_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_grants_org_pending_key" ON "program"."sponsor_grants" USING btree ("org_id","sponsor_id") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_grants_org_order_key" ON "program"."sponsor_grants" USING btree ("org_id","order_id") WHERE order_id is not null;--> statement-breakpoint
CREATE INDEX "sponsor_grants_org_event_tier_idx" ON "program"."sponsor_grants" USING btree ("org_id","event_id","tier_id","status");--> statement-breakpoint
CREATE INDEX "sponsor_packages_org_id_idx" ON "program"."sponsor_packages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_packages_org_tier_key" ON "program"."sponsor_packages" USING btree ("org_id","tier_id");--> statement-breakpoint
CREATE INDEX "sponsor_packages_org_event_idx" ON "program"."sponsor_packages" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "sponsor_profiles_org_id_idx" ON "program"."sponsor_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_profiles_org_sponsor_key" ON "program"."sponsor_profiles" USING btree ("org_id","sponsor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_profiles_org_exhibitor_key" ON "program"."sponsor_profiles" USING btree ("org_id","exhibitor_id") WHERE exhibitor_id is not null;--> statement-breakpoint
CREATE INDEX "sponsor_profiles_org_event_idx" ON "program"."sponsor_profiles" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "sponsored_sessions_org_id_idx" ON "program"."sponsored_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsored_sessions_org_session_key" ON "program"."sponsored_sessions" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE INDEX "sponsored_sessions_org_sponsor_idx" ON "program"."sponsored_sessions" USING btree ("org_id","sponsor_id");--> statement-breakpoint
-- hand-written: begin (M5.4b: CHECKs on the existing exhibitor_settings table added NOT VALID, then validated)
ALTER TABLE "program"."exhibitor_settings" ADD CONSTRAINT "exhibitor_settings_lead_licenses_check" CHECK (included_lead_licenses between 0 and 50) NOT VALID;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_settings" VALIDATE CONSTRAINT "exhibitor_settings_lead_licenses_check";--> statement-breakpoint
ALTER TABLE "program"."exhibitor_settings" ADD CONSTRAINT "exhibitor_settings_lead_price_check" CHECK (lead_license_price_minor is null or lead_license_price_minor between 1 and 100000000) NOT VALID;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_settings" VALIDATE CONSTRAINT "exhibitor_settings_lead_price_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin
-- M5.4b cross-module composite FKs, down the tiers (program 3 → events 2); new tables, so no NOT VALID needed.
ALTER TABLE "program"."sponsor_packages" ADD CONSTRAINT "sponsor_packages_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."sponsor_grants" ADD CONSTRAINT "sponsor_grants_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."sponsor_profiles" ADD CONSTRAINT "sponsor_profiles_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."sponsor_deliverables" ADD CONSTRAINT "sponsor_deliverables_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."sponsored_sessions" ADD CONSTRAINT "sponsored_sessions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."lead_license_purchases" ADD CONSTRAINT "lead_license_purchases_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."lead_licenses" ADD CONSTRAINT "lead_licenses_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- A sponsor's exhibitor link clears (only that column) when the exhibitor is deleted.
ALTER TABLE "program"."sponsor_profiles" ADD CONSTRAINT "sponsor_profiles_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE SET NULL ("exhibitor_id");--> statement-breakpoint
-- A lead license seat belongs to one exhibitor portal account (events.portal_accounts, tier 2).
ALTER TABLE "program"."lead_licenses" ADD CONSTRAINT "lead_licenses_account_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "events"."portal_accounts"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- P5-4: lead retrieval is an event add-on, free in beta (price null), priced later with no code change.
INSERT INTO billing.addons (key, name, kind, modules, price_minor, currency, quotas) VALUES
  ('lead_retrieval', 'Lead retrieval', 'event_addon', ARRAY['exhibitors'], NULL, NULL, '{"leadLicenses": 2000}'::jsonb)
  ON CONFLICT (key) DO NOTHING;
-- hand-written: end--> statement-breakpoint
CREATE POLICY "addon_items_tenant_isolation" ON "orders"."addon_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "lead_license_purchases_tenant_isolation" ON "program"."lead_license_purchases" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "lead_licenses_tenant_isolation" ON "program"."lead_licenses" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sponsor_deliverables_tenant_isolation" ON "program"."sponsor_deliverables" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sponsor_grants_tenant_isolation" ON "program"."sponsor_grants" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sponsor_packages_tenant_isolation" ON "program"."sponsor_packages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sponsor_profiles_tenant_isolation" ON "program"."sponsor_profiles" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sponsored_sessions_tenant_isolation" ON "program"."sponsored_sessions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));