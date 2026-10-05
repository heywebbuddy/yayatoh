CREATE TABLE "orders"."invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_part_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"funds_flow" text,
	"connected_account_id" text,
	"provider" text,
	"provider_payment_id" text,
	"reference" text,
	"note" text,
	"received_on" date,
	"recorded_by" text NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "invoice_payments_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "invoice_payments_channel_check" CHECK (channel in ('pay_link', 'offline')),
	CONSTRAINT "invoice_payments_method_check" CHECK (method in ('card', 'check', 'wire', 'cash', 'other')),
	CONSTRAINT "invoice_payments_status_check" CHECK (status in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "invoice_payments_amount_check" CHECK (amount_minor > 0 and fee_part_minor between 0 and amount_minor),
	CONSTRAINT "invoice_payments_kind_check" CHECK ((channel = 'pay_link') = (method = 'card') and (channel = 'pay_link' or (status = 'succeeded' and received_on is not null))),
	CONSTRAINT "invoice_payments_flow_check" CHECK ((channel = 'offline') = (funds_flow is null) and (funds_flow is null or funds_flow in ('organizer_mor', 'platform_mor')) and ((funds_flow = 'organizer_mor') = (connected_account_id is not null))),
	CONSTRAINT "invoice_payments_done_check" CHECK ((status = 'pending') = (completed_at is null)),
	CONSTRAINT "invoice_payments_reference_check" CHECK (reference is null or length(reference) between 1 and 80),
	CONSTRAINT "invoice_payments_note_check" CHECK (note is null or length(note) <= 500),
	CONSTRAINT "invoice_payments_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "orders"."invoice_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."invoice_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."invoice_sequences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_sequences_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "invoice_sequences_last_check" CHECK (last_number >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders"."invoice_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."invoice_sequences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"po_number" text,
	"billing_company" text,
	"buyer_name" text NOT NULL,
	"buyer_email" text NOT NULL,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"fee_allocated_minor" bigint DEFAULT 0 NOT NULL,
	"terms" text NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"issued_by" text NOT NULL,
	CONSTRAINT "invoices_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "invoices_number_check" CHECK (number >= 1),
	CONSTRAINT "invoices_status_check" CHECK (status in ('open', 'paid', 'void')),
	CONSTRAINT "invoices_amounts_check" CHECK (total_minor > 0 and fee_minor between 0 and total_minor and paid_minor >= 0 and fee_allocated_minor between 0 and fee_minor),
	CONSTRAINT "invoices_paid_check" CHECK ((status = 'paid') = (paid_at is not null) and (status <> 'paid' or paid_minor >= total_minor)),
	CONSTRAINT "invoices_void_check" CHECK ((status = 'void') = (voided_at is not null)),
	CONSTRAINT "invoices_due_check" CHECK (due_on >= issued_on),
	CONSTRAINT "invoices_terms_check" CHECK (terms in ('net30_event7')),
	CONSTRAINT "invoices_po_check" CHECK (po_number is null or length(po_number) between 1 and 60),
	CONSTRAINT "invoices_company_check" CHECK (billing_company is null or length(billing_company) between 1 and 120),
	CONSTRAINT "invoices_void_reason_check" CHECK (void_reason is null or length(void_reason) between 3 and 500),
	CONSTRAINT "invoices_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "orders"."invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" DROP CONSTRAINT "journey_runs_trigger_check";--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" DROP CONSTRAINT "journey_steps_anchor_check";--> statement-breakpoint
ALTER TABLE "automations"."journeys" DROP CONSTRAINT "journeys_trigger_check";--> statement-breakpoint
ALTER TABLE "automations"."journeys" DROP CONSTRAINT "journeys_template_check";--> statement-breakpoint
ALTER TABLE "checkin"."scans" DROP CONSTRAINT "scans_result_check";--> statement-breakpoint
ALTER TABLE "orders"."orders" DROP CONSTRAINT "orders_status_check";--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ADD COLUMN "balance_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD COLUMN "pay_later" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD COLUMN "po_number" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" ADD COLUMN "payment_due" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "orders"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."invoice_payments" ADD CONSTRAINT "invoice_payments_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."invoices" ADD CONSTRAINT "invoices_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_payments_org_id_idx" ON "orders"."invoice_payments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_org_key" ON "orders"."invoice_payments" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_org_provider_key" ON "orders"."invoice_payments" USING btree ("org_id","provider","provider_payment_id") WHERE provider_payment_id is not null;--> statement-breakpoint
CREATE INDEX "invoice_payments_org_invoice_idx" ON "orders"."invoice_payments" USING btree ("org_id","invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_payments_org_order_idx" ON "orders"."invoice_payments" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "invoice_sequences_org_id_idx" ON "orders"."invoice_sequences" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_sequences_org_key" ON "orders"."invoice_sequences" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invoices_org_id_idx" ON "orders"."invoices" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_key" ON "orders"."invoices" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_order_key" ON "orders"."invoices" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "invoices_org_event_status_idx" ON "orders"."invoices" USING btree ("org_id","event_id","status","due_on");--> statement-breakpoint
-- hand-written: begin (M5.1d: CHECKs on existing tables (orders, scans, journeys, journey_steps, journey_runs, registration_types) added NOT VALID, then validated)
ALTER TABLE "automations"."journey_runs" ADD CONSTRAINT "journey_runs_trigger_check" CHECK (trigger in ('order_paid', 'checked_in', 'event_time', 'invoice_issued', 'rsvp_sent')) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" ADD CONSTRAINT "journey_steps_anchor_check" CHECK (anchor in ('trigger', 'event_start', 'event_end', 'invoice_due', 'rsvp_deadline')) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journeys" ADD CONSTRAINT "journeys_trigger_check" CHECK (trigger in ('order_paid', 'checked_in', 'event_time', 'invoice_issued', 'rsvp_sent')) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journeys" ADD CONSTRAINT "journeys_template_check" CHECK (template is null or template in ('vision', 'rsvp_reminders', 'invoice_reminders')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_result_check" CHECK (result in ('admitted', 'duplicate', 'invalid', 'void', 'wrong_event', 'not_today', 'outside_window', 'wrong_date', 'duplicate_offline', 'superseded', 'provisional', 'granted', 'no_access', 'wrong_checkpoint', 'balance_due')) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_status_check" CHECK (status in ('reserved', 'awaiting_payment', 'payment_failed', 'paid', 'expired', 'cancelled', 'partially_refunded', 'refunded', 'awaiting_invoice', 'void')) NOT VALID;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD CONSTRAINT "registration_types_pay_later_check" CHECK (po_number in ('off', 'optional', 'required') and (pay_later or po_number = 'off')) NOT VALID;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" VALIDATE CONSTRAINT "journey_runs_trigger_check";--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" VALIDATE CONSTRAINT "journey_steps_anchor_check";--> statement-breakpoint
ALTER TABLE "automations"."journeys" VALIDATE CONSTRAINT "journeys_trigger_check";--> statement-breakpoint
ALTER TABLE "automations"."journeys" VALIDATE CONSTRAINT "journeys_template_check";--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_result_check";--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_status_check";--> statement-breakpoint
ALTER TABLE "registration"."registration_types" VALIDATE CONSTRAINT "registration_types_pay_later_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M5.1d: cross-module foreign key, down the tiers: orders 4 → events 2)
ALTER TABLE "orders"."invoices" ADD CONSTRAINT "invoices_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
-- hand-written: end
CREATE POLICY "invoice_payments_tenant_isolation" ON "orders"."invoice_payments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "invoice_sequences_tenant_isolation" ON "orders"."invoice_sequences" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "invoices_tenant_isolation" ON "orders"."invoices" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));