CREATE TABLE "orders"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"amount_minor" bigint NOT NULL,
	"fee_refunded_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"ticket_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"provider_refund_id" text,
	"failure_code" text,
	"requested_by" text NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "refunds_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "refunds_status_check" CHECK (status in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "refunds_reason_check" CHECK (reason in ('requested_by_customer', 'event_cancelled', 'event_postponed', 'duplicate', 'fraudulent', 'goodwill')),
	CONSTRAINT "refunds_amount_check" CHECK (amount_minor > 0 and fee_refunded_minor between 0 and amount_minor)
);
--> statement-breakpoint
ALTER TABLE "orders"."refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."refunds" ADD CONSTRAINT "refunds_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_org_id_idx" ON "orders"."refunds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "refunds_org_order_idx" ON "orders"."refunds" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE POLICY "refunds_tenant_isolation" ON "orders"."refunds" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));