CREATE TABLE "ticketing"."coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"buyer_contact_id" uuid NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "coupon_redemptions_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "ticketing"."coupon_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."coupon_redemptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticketing"."coupons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"percent_bps" integer,
	"amount_minor" bigint,
	"currency" text,
	"scope" text DEFAULT 'all' NOT NULL,
	"event_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"max_redemptions" integer,
	"per_buyer_limit" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "coupons_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "coupons_code_check" CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
	CONSTRAINT "coupons_kind_check" CHECK (kind in ('percent', 'amount')),
	CONSTRAINT "coupons_value_check" CHECK ((kind = 'percent' and percent_bps between 1 and 10000 and amount_minor is null and currency is null) or (kind = 'amount' and amount_minor > 0 and percent_bps is null and currency ~ '^[A-Z]{3}$')),
	CONSTRAINT "coupons_scope_check" CHECK ((scope = 'all' and cardinality(event_ids) = 0) or (scope = 'events' and cardinality(event_ids) >= 1)),
	CONSTRAINT "coupons_redemptions_check" CHECK (redeemed_count >= 0 and (max_redemptions is null or (max_redemptions >= 1 and redeemed_count <= max_redemptions))),
	CONSTRAINT "coupons_per_buyer_check" CHECK (per_buyer_limit is null or per_buyer_limit >= 1),
	CONSTRAINT "coupons_window_check" CHECK (ends_at is null or starts_at is null or ends_at > starts_at)
);
--> statement-breakpoint
ALTER TABLE "ticketing"."coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."coupons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "ticketing"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_fk" FOREIGN KEY ("org_id","coupon_id") REFERENCES "ticketing"."coupons"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_redemptions_org_id_idx" ON "ticketing"."coupon_redemptions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_org_order_key" ON "ticketing"."coupon_redemptions" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_org_coupon_buyer_idx" ON "ticketing"."coupon_redemptions" USING btree ("org_id","coupon_id","buyer_contact_id");--> statement-breakpoint
CREATE INDEX "coupons_org_id_idx" ON "ticketing"."coupons" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_org_code_key" ON "ticketing"."coupons" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "events_org_id_currency_key" ON "events"."events" USING btree ("org_id","id","currency");--> statement-breakpoint
CREATE POLICY "coupon_redemptions_tenant_isolation" ON "ticketing"."coupon_redemptions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "coupons_tenant_isolation" ON "ticketing"."coupons" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (U9: cross-module composite FKs; on existing tables NOT VALID, then validated)
-- An order took at most one org coupon (like orders_promo_code_fk).
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_coupon_fk" FOREIGN KEY ("org_id","coupon_id") REFERENCES "ticketing"."coupons"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_coupon_fk";--> statement-breakpoint
-- Totals never mix currencies: an order is in its event's currency, and the event's currency
-- cannot change while any order references it (NO ACTION: the lock after the first sale).
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_event_currency_fk" FOREIGN KEY ("org_id","event_id","currency") REFERENCES "events"."events"("org_id","id","currency") NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_event_currency_fk";--> statement-breakpoint
-- Ticket types and promo codes follow the event's currency while it may still change.
ALTER TABLE "ticketing"."ticket_types" ADD CONSTRAINT "ticket_types_event_currency_fk" FOREIGN KEY ("org_id","event_id","currency") REFERENCES "events"."events"("org_id","id","currency") ON UPDATE CASCADE NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" VALIDATE CONSTRAINT "ticket_types_event_currency_fk";--> statement-breakpoint
ALTER TABLE "ticketing"."promo_codes" ADD CONSTRAINT "promo_codes_event_currency_fk" FOREIGN KEY ("org_id","event_id","currency") REFERENCES "events"."events"("org_id","id","currency") ON UPDATE CASCADE NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."promo_codes" VALIDATE CONSTRAINT "promo_codes_event_currency_fk";
-- hand-written: end
