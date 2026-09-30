CREATE TABLE "payments"."legacy_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"instance" text NOT NULL,
	"event_id" uuid,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"customer_paid_minor" bigint NOT NULL,
	"commission_minor" bigint NOT NULL,
	"admin_tax_minor" bigint NOT NULL,
	"organizer_earning_minor" bigint NOT NULL,
	"transferred_minor" bigint NOT NULL,
	"open_minor" bigint NOT NULL,
	"clawback_minor" bigint DEFAULT 0 NOT NULL,
	"source_rows" bigint NOT NULL,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	CONSTRAINT "legacy_settlements_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "legacy_settlements_kind_check" CHECK (kind in ('event_statement', 'opening_balance')),
	CONSTRAINT "legacy_settlements_status_check" CHECK (status in ('settled', 'open', 'pending_signoff', 'signed_off')),
	CONSTRAINT "legacy_settlements_instance_check" CHECK (instance in ('yay', 'abc')),
	CONSTRAINT "legacy_settlements_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "legacy_settlements_event_check" CHECK ((kind = 'event_statement') = (event_id is not null)),
	CONSTRAINT "legacy_settlements_amounts_check" CHECK (customer_paid_minor >= 0 and commission_minor >= 0 and admin_tax_minor >= 0 and organizer_earning_minor >= 0 and transferred_minor >= 0 and open_minor >= 0 and clawback_minor >= 0 and source_rows >= 0),
	CONSTRAINT "legacy_settlements_signoff_check" CHECK ((status = 'signed_off') = (signed_off_at is not null))
);
--> statement-breakpoint
ALTER TABLE "payments"."legacy_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."legacy_settlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."org_relationships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"child_org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"detached_at" timestamp with time zone,
	CONSTRAINT "org_relationships_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_relationships_kind_check" CHECK (kind in ('agency_client', 'host_affiliate', 'venue_partner')),
	CONSTRAINT "org_relationships_not_self" CHECK (child_org_id <> org_id)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."org_relationships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."org_relationships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."scans" DROP CONSTRAINT "scans_code_kind_check";--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "charge_model" text;--> statement-breakpoint
ALTER TABLE "tenancy"."org_relationships" ADD CONSTRAINT "org_relationships_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."org_relationships" ADD CONSTRAINT "org_relationships_child_fk" FOREIGN KEY ("child_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legacy_settlements_org_id_idx" ON "payments"."legacy_settlements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "legacy_settlements_org_event_idx" ON "payments"."legacy_settlements" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_settlements_org_statement_key" ON "payments"."legacy_settlements" USING btree ("org_id","kind","instance",coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid),"currency");--> statement-breakpoint
CREATE INDEX "org_relationships_org_id_idx" ON "tenancy"."org_relationships" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_relationships_org_child_kind_key" ON "tenancy"."org_relationships" USING btree ("org_id","child_org_id","kind");--> statement-breakpoint
-- hand-written: begin — CHECKs on existing tables are added NOT VALID, then validated (no long lock).
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_code_kind_check" CHECK (code_kind in ('yy1', 'short', 'legacy', 'unknown')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_code_kind_check";--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_charge_model_check" CHECK (charge_model is null or charge_model in ('legacy_platform', 'legacy_direct_connected', 'legacy_destination', 'paypal', 'offline', 'sct')) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_charge_model_check";--> statement-breakpoint
-- Cross-module composite FK: a legacy event statement points at its migrated event (same org).
ALTER TABLE "payments"."legacy_settlements" ADD CONSTRAINT "legacy_settlements_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- hand-written: end
CREATE POLICY "legacy_settlements_tenant_isolation" ON "payments"."legacy_settlements" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "org_relationships_tenant_isolation" ON "tenancy"."org_relationships" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));