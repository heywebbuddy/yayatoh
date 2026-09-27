CREATE SCHEMA "orders";
--> statement-breakpoint
CREATE SCHEMA "payments";
--> statement-breakpoint
CREATE TABLE "orders"."order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_face_minor" bigint NOT NULL,
	"unit_fee_minor" bigint NOT NULL,
	"unit_all_in_minor" bigint NOT NULL,
	"unit_organizer_net_minor" bigint NOT NULL,
	CONSTRAINT "order_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "order_items_quantity_check" CHECK (quantity >= 1)
);
--> statement-breakpoint
ALTER TABLE "orders"."order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."order_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text NOT NULL,
	"buyer_email" text NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_user_id" uuid,
	"locale" text DEFAULT 'en' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"funds_flow" text NOT NULL,
	"fee_schedule" jsonb NOT NULL,
	"provider" text,
	"provider_payment_id" text,
	"manage_token_hash" text NOT NULL,
	"created_via" text DEFAULT 'web' NOT NULL,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "orders_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "orders_status_check" CHECK (status in ('reserved', 'awaiting_payment', 'payment_failed', 'paid', 'expired', 'cancelled', 'partially_refunded', 'refunded')),
	CONSTRAINT "orders_totals_check" CHECK (subtotal_minor >= 0 and fee_minor >= 0 and total_minor = subtotal_minor + fee_minor),
	CONSTRAINT "orders_funds_flow_check" CHECK (funds_flow in ('organizer_mor', 'platform_mor')),
	CONSTRAINT "orders_email_lower_check" CHECK (buyer_email = lower(buyer_email))
);
--> statement-breakpoint
ALTER TABLE "orders"."orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments"."provider_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "provider_events_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "provider_events_provider_check" CHECK (provider in ('fake', 'stripe'))
);
--> statement-breakpoint
ALTER TABLE "payments"."provider_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."provider_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_org_id_idx" ON "orders"."order_items" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "order_items_org_order_idx" ON "orders"."order_items" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "orders_org_id_idx" ON "orders"."orders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "orders_org_event_created_idx" ON "orders"."orders" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_org_status_expires_idx" ON "orders"."orders" USING btree ("org_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_manage_token_hash_key" ON "orders"."orders" USING btree ("manage_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_provider_payment_key" ON "orders"."orders" USING btree ("org_id","provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "provider_events_org_id_idx" ON "payments"."provider_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_org_provider_event_key" ON "payments"."provider_events" USING btree ("org_id","provider","provider_event_id");--> statement-breakpoint
CREATE POLICY "order_items_tenant_isolation" ON "orders"."order_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "orders_tenant_isolation" ON "orders"."orders" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "provider_events_tenant_isolation" ON "payments"."provider_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));