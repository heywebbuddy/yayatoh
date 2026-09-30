CREATE TABLE "payments"."payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"account_class" text DEFAULT 'standard' NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"requirements_due" text[] DEFAULT '{}'::text[] NOT NULL,
	"country" text NOT NULL,
	"default_currency" text,
	"last_event_at" timestamp with time zone,
	CONSTRAINT "payment_accounts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "payment_accounts_provider_check" CHECK (provider in ('fake', 'stripe')),
	CONSTRAINT "payment_accounts_class_check" CHECK (account_class in ('standard', 'express', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "payments"."payment_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."payment_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "connected_account_id" text;--> statement-breakpoint
CREATE INDEX "payment_accounts_org_id_idx" ON "payments"."payment_accounts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_org_key" ON "payments"."payment_accounts" USING btree ("org_id");--> statement-breakpoint
-- Existing table: NOT VALID + VALIDATE keeps the lock short (expand/contract).
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_connected_account_check" CHECK ((funds_flow = 'organizer_mor') = (connected_account_id is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_connected_account_check";--> statement-breakpoint
CREATE POLICY "payment_accounts_tenant_isolation" ON "payments"."payment_accounts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));