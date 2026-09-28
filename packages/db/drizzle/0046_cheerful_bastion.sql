CREATE TABLE "orders"."refund_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"days_before" integer,
	"retained_minor" bigint DEFAULT 0 NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "refund_policies_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "refund_policies_kind_check" CHECK (kind in ('none', 'until', 'always')),
	CONSTRAINT "refund_policies_days_check" CHECK ((kind = 'until') = (days_before is not null) and (days_before is null or days_before between 0 and 365)),
	CONSTRAINT "refund_policies_retained_check" CHECK (retained_minor >= 0 and (kind <> 'none' or retained_minor = 0))
);
--> statement-breakpoint
ALTER TABLE "orders"."refund_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."refund_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments"."reconciliation_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"currency" text NOT NULL,
	"ledger_minor" bigint NOT NULL,
	"provider_minor" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "reconciliation_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "reconciliation_items_kind_check" CHECK (kind in ('missing_at_provider', 'missing_in_ledger', 'amount_mismatch')),
	CONSTRAINT "reconciliation_items_status_check" CHECK (status in ('open', 'resolved')),
	CONSTRAINT "reconciliation_items_differs_check" CHECK (ledger_minor <> provider_minor),
	CONSTRAINT "reconciliation_items_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "reconciliation_items_resolved_check" CHECK ((status = 'open') = (resolved_at is null) and (status = 'open' or length(resolution_note) between 3 and 500))
);
--> statement-breakpoint
ALTER TABLE "payments"."reconciliation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."reconciliation_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments"."reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"ledger_count" integer NOT NULL,
	"provider_count" integer NOT NULL,
	"item_count" integer NOT NULL,
	CONSTRAINT "reconciliation_runs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "reconciliation_runs_provider_check" CHECK (provider in ('fake', 'stripe')),
	CONSTRAINT "reconciliation_runs_counts_check" CHECK (ledger_count >= 0 and provider_count >= 0 and item_count >= 0)
);
--> statement-breakpoint
ALTER TABLE "payments"."reconciliation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."reconciliation_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "risk_review" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."refunds" ADD COLUMN "retained_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."refunds" ADD COLUMN "policy_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments"."disputes" ADD COLUMN "evidence_summary" text;--> statement-breakpoint
ALTER TABLE "payments"."disputes" ADD COLUMN "evidence_excluded" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "payments"."reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "payments"."reconciliation_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_policies_org_id_idx" ON "orders"."refund_policies" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_policies_org_event_key" ON "orders"."refund_policies" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "reconciliation_items_org_id_idx" ON "payments"."reconciliation_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_items_org_ref_key" ON "payments"."reconciliation_items" USING btree ("org_id","day","reference","currency");--> statement-breakpoint
CREATE INDEX "reconciliation_items_org_status_idx" ON "payments"."reconciliation_items" USING btree ("org_id","status","day");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_org_id_idx" ON "payments"."reconciliation_runs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_runs_org_day_key" ON "payments"."reconciliation_runs" USING btree ("org_id","day");--> statement-breakpoint
CREATE POLICY "refund_policies_tenant_isolation" ON "orders"."refund_policies" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "reconciliation_items_tenant_isolation" ON "payments"."reconciliation_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "reconciliation_runs_tenant_isolation" ON "payments"."reconciliation_runs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FK, down the tiers (orders 4 → events 2); a new table, so no NOT VALID needed.
ALTER TABLE "orders"."refund_policies" ADD CONSTRAINT "refund_policies_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
