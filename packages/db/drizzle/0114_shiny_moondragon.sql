CREATE TABLE "billing"."plan_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_plan_key" text,
	"to_plan_key" text NOT NULL,
	"price_lookup_key" text NOT NULL,
	"direction" text NOT NULL,
	"currency" text NOT NULL,
	"amount_due_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"discount_minor" bigint NOT NULL,
	"removed_modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "plan_changes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "plan_changes_direction_check" CHECK (direction in ('upgrade', 'downgrade', 'switch', 'start')),
	CONSTRAINT "plan_changes_status_check" CHECK (status in ('requested', 'submitted', 'failed')),
	CONSTRAINT "plan_changes_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "plan_changes_tax_check" CHECK (tax_minor >= 0 and discount_minor >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing"."plan_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."plan_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."usage_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meter" text NOT NULL,
	"quantity" integer NOT NULL,
	"source_event_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone,
	"report_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_records_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "usage_records_meter_check" CHECK (meter in ('email', 'sms', 'whatsapp', 'ai_credits', 'devices')),
	CONSTRAINT "usage_records_quantity_check" CHECK (quantity <> 0 and quantity between -1000000 and 1000000),
	CONSTRAINT "usage_records_attempts_check" CHECK (report_attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing"."usage_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."usage_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" ADD COLUMN "dunning_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" ADD COLUMN "read_only_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" ADD COLUMN "nonprofit_discount" text;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" ADD COLUMN "discount_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" ADD COLUMN "discount_pushed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "plan_changes_org_id_idx" ON "billing"."plan_changes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_changes_org_idempotency_key" ON "billing"."plan_changes" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "plan_changes_org_created_idx" ON "billing"."plan_changes" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_records_org_id_idx" ON "billing"."usage_records" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_org_event_meter_key" ON "billing"."usage_records" USING btree ("org_id","source_event_id","meter");--> statement-breakpoint
CREATE INDEX "usage_records_org_occurred_idx" ON "billing"."usage_records" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_records_org_unreported_idx" ON "billing"."usage_records" USING btree ("org_id","created_at") WHERE reported_at is null;--> statement-breakpoint
-- hand-written: begin
-- Existing table: NOT VALID + VALIDATE keeps the lock short (expand/contract).
ALTER TABLE "billing"."org_billing" ADD CONSTRAINT "org_billing_nonprofit_discount_check" CHECK (nonprofit_discount is null or nonprofit_discount in ('verified_charity', 'staff')) NOT VALID;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" VALIDATE CONSTRAINT "org_billing_nonprofit_discount_check";--> statement-breakpoint
ALTER TABLE "billing"."org_billing" ADD CONSTRAINT "org_billing_dunning_check" CHECK ((dunning_started_at is null) = (grace_ends_at is null) and (read_only_at is null or dunning_started_at is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "billing"."org_billing" VALIDATE CONSTRAINT "org_billing_dunning_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "plan_changes_tenant_isolation" ON "billing"."plan_changes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "usage_records_tenant_isolation" ON "billing"."usage_records" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));