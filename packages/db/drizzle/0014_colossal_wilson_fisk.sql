CREATE TABLE "ticketing"."promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"percent_bps" integer,
	"amount_minor" bigint,
	"currency" text NOT NULL,
	"ticket_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "promo_codes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "promo_codes_code_check" CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
	CONSTRAINT "promo_codes_kind_check" CHECK (kind in ('percent', 'amount')),
	CONSTRAINT "promo_codes_value_check" CHECK ((kind = 'percent' and percent_bps between 1 and 10000 and amount_minor is null) or (kind = 'amount' and amount_minor > 0 and percent_bps is null)),
	CONSTRAINT "promo_codes_redemptions_check" CHECK (redeemed_count >= 0 and (max_redemptions is null or (max_redemptions >= 1 and redeemed_count <= max_redemptions))),
	CONSTRAINT "promo_codes_window_check" CHECK (ends_at is null or starts_at is null or ends_at > starts_at),
	CONSTRAINT "promo_codes_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "ticketing"."promo_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."promo_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."order_items" ADD COLUMN "unit_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "promo_code" text;--> statement-breakpoint
CREATE INDEX "promo_codes_org_id_idx" ON "ticketing"."promo_codes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_org_event_code_key" ON "ticketing"."promo_codes" USING btree ("org_id","event_id","code");--> statement-breakpoint
-- Existing tables: NOT VALID + VALIDATE keeps the lock short (expand/contract).
ALTER TABLE "orders"."order_items" ADD CONSTRAINT "order_items_discount_check" CHECK (unit_discount_minor between 0 and unit_face_minor) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."order_items" VALIDATE CONSTRAINT "order_items_discount_check";--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_discount_check" CHECK (discount_minor >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_discount_check";--> statement-breakpoint
CREATE POLICY "promo_codes_tenant_isolation" ON "ticketing"."promo_codes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- Cross-module FK, hand-written (orders, tier 4 → ticketing, tier 3).
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_promo_code_fk" FOREIGN KEY ("org_id","promo_code_id") REFERENCES "ticketing"."promo_codes"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_promo_code_fk";
