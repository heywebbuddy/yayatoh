CREATE TABLE "donations"."gift_refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gift_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"refunded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gift_refunds_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "gift_refunds_amount_check" CHECK (amount_minor > 0),
	CONSTRAINT "gift_refunds_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "donations"."gift_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."gift_refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."matches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"sponsor_name" text NOT NULL,
	"sponsor_email" text,
	"public_name" text,
	"ratio_percent" integer NOT NULL,
	"cap_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"matched_minor" bigint,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "matches_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "matches_status_check" CHECK (status in ('active', 'closed', 'cancelled')),
	CONSTRAINT "matches_sponsor_name_length" CHECK (length(sponsor_name) between 1 and 120),
	CONSTRAINT "matches_sponsor_email_check" CHECK (sponsor_email is null or (sponsor_email = lower(sponsor_email) and length(sponsor_email) between 3 and 254)),
	CONSTRAINT "matches_public_name_length" CHECK (public_name is null or length(public_name) between 1 and 120),
	CONSTRAINT "matches_ratio_check" CHECK (ratio_percent between 1 and 1000),
	CONSTRAINT "matches_cap_check" CHECK (cap_minor between 100 and 1000000000),
	CONSTRAINT "matches_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "matches_window_check" CHECK (ends_at > starts_at),
	CONSTRAINT "matches_closed_check" CHECK ((status = 'closed') = (closed_at is not null) and (status = 'closed') = (matched_minor is not null)),
	CONSTRAINT "matches_cancelled_check" CHECK ((status = 'cancelled') = (cancelled_at is not null)),
	CONSTRAINT "matches_matched_check" CHECK (matched_minor is null or matched_minor between 0 and cap_minor)
);
--> statement-breakpoint
ALTER TABLE "donations"."matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."matches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."pledges" DROP CONSTRAINT "pledges_source_check";--> statement-breakpoint
ALTER TABLE "donations"."pledges" ALTER COLUMN "call_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "donations"."pledges" ALTER COLUMN "entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "donations"."pledges" ALTER COLUMN "paddle_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "donations"."pledges" ADD COLUMN "match_id" uuid;--> statement-breakpoint
ALTER TABLE "donations"."gift_refunds" ADD CONSTRAINT "gift_refunds_gift_fk" FOREIGN KEY ("org_id","gift_id") REFERENCES "donations"."gifts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."matches" ADD CONSTRAINT "matches_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "donations"."campaigns"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_refunds_org_id_idx" ON "donations"."gift_refunds" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_refunds_org_refund_key" ON "donations"."gift_refunds" USING btree ("org_id","refund_id");--> statement-breakpoint
CREATE INDEX "gift_refunds_org_gift_idx" ON "donations"."gift_refunds" USING btree ("org_id","gift_id");--> statement-breakpoint
CREATE INDEX "matches_org_id_idx" ON "donations"."matches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "matches_org_campaign_status_idx" ON "donations"."matches" USING btree ("org_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "matches_org_event_starts_idx" ON "donations"."matches" USING btree ("org_id","event_id","starts_at");--> statement-breakpoint
-- hand-written: begin
-- M4.8f: pledges is an existing table (M4.8c), so its new foreign key and checks are added NOT VALID
-- and validated after, keeping the lock short (expand/contract). The partial unique index on the new
-- column is built in the migration transaction: fine before launch (no production rows).
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_match_fk" FOREIGN KEY ("org_id","match_id") REFERENCES "donations"."matches"("org_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "donations"."pledges" VALIDATE CONSTRAINT "pledges_match_fk";--> statement-breakpoint
-- hand-written: end
CREATE UNIQUE INDEX "pledges_org_match_key" ON "donations"."pledges" USING btree ("org_id","match_id") WHERE match_id is not null;--> statement-breakpoint
-- hand-written: begin
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_source_shape_check" CHECK ((source = 'paddle' and call_id is not null and entry_id is not null and paddle_number is not null and match_id is null) or (source = 'match' and match_id is not null and call_id is null and entry_id is null and paddle_number is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "donations"."pledges" VALIDATE CONSTRAINT "pledges_source_shape_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_source_check" CHECK (source in ('paddle', 'match')) NOT VALID;--> statement-breakpoint
ALTER TABLE "donations"."pledges" VALIDATE CONSTRAINT "pledges_source_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "gift_refunds_tenant_isolation" ON "donations"."gift_refunds" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "matches_tenant_isolation" ON "donations"."matches" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.8f cross-module composite FKs (donations is tier 5; events tier 2, orders tier 4). A match keeps
-- its event (it may carry the sponsor's pledge, a money promise: like pledges, no cascade). A gift's
-- refund row points at the orders module's refund it records.
ALTER TABLE "donations"."matches" ADD CONSTRAINT "matches_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "donations"."gift_refunds" ADD CONSTRAINT "gift_refunds_refund_fk" FOREIGN KEY ("org_id","refund_id") REFERENCES "orders"."refunds"("org_id","id");
-- hand-written: end
