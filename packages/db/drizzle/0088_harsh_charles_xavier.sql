CREATE TABLE "orders"."credit_note_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "credit_note_applications_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "credit_note_applications_amount_check" CHECK (amount_minor > 0)
);
--> statement-breakpoint
ALTER TABLE "orders"."credit_note_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."credit_note_applications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."credit_note_sequences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "credit_note_sequences_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "credit_note_sequences_last_check" CHECK (last_number >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders"."credit_note_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."credit_note_sequences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"disposition" text NOT NULL,
	"reason" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"balance_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"code" text,
	"buyer_name" text NOT NULL,
	"buyer_email" text NOT NULL,
	"issued_by" text NOT NULL,
	CONSTRAINT "credit_notes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "credit_notes_number_check" CHECK (number >= 1),
	CONSTRAINT "credit_notes_kind_check" CHECK (kind in ('full', 'partial')),
	CONSTRAINT "credit_notes_disposition_check" CHECK (disposition in ('store_credit', 'refunded')),
	CONSTRAINT "credit_notes_reason_check" CHECK (length(reason) between 3 and 500),
	CONSTRAINT "credit_notes_amount_check" CHECK (amount_minor > 0 and balance_minor between 0 and amount_minor),
	CONSTRAINT "credit_notes_store_credit_check" CHECK ((disposition = 'store_credit') = (code is not null) and (disposition = 'store_credit' or balance_minor = 0)),
	CONSTRAINT "credit_notes_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "orders"."credit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."credit_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."support_macro_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"macro_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"macro_name" text NOT NULL,
	"actions" text[] NOT NULL,
	"reply_subject" text NOT NULL,
	"reply_body" text NOT NULL,
	"ran_by" text NOT NULL,
	CONSTRAINT "support_macro_runs_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "orders"."support_macro_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."support_macro_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."support_macros" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"actions" text[] NOT NULL,
	"updated_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "support_macros_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "support_macros_name_check" CHECK (length(name) between 2 and 80),
	CONSTRAINT "support_macros_subject_check" CHECK (length(subject) between 1 and 200),
	CONSTRAINT "support_macros_body_check" CHECK (length(body) between 1 and 5000),
	CONSTRAINT "support_macros_actions_check" CHECK (cardinality(actions) between 1 and 4 and actions <@ array['email_buyer', 'add_note', 'resend_tickets', 'transfer_ticket']::text[])
);
--> statement-breakpoint
ALTER TABLE "orders"."support_macros" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."support_macros" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticketing"."ticket_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"initiated_by" text NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"to_name" text NOT NULL,
	"to_email" text NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"created_by" text NOT NULL,
	"from_rev" integer NOT NULL,
	"to_rev" integer,
	"claimed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "ticket_transfers_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "ticket_transfers_status_check" CHECK (status in ('pending', 'claimed', 'cancelled')),
	CONSTRAINT "ticket_transfers_initiated_by_check" CHECK (initiated_by in ('organizer', 'holder')),
	CONSTRAINT "ticket_transfers_fee_check" CHECK (fee_minor >= 0),
	CONSTRAINT "ticket_transfers_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "ticket_transfers_email_lower_check" CHECK (to_email = lower(to_email)),
	CONSTRAINT "ticket_transfers_state_check" CHECK ((status = 'claimed') = (claimed_at is not null and to_rev is not null) and (status = 'cancelled') = (cancelled_at is not null))
);
--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_transfers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticketing"."wallet_passes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"rev" integer NOT NULL,
	"serial" text NOT NULL,
	"holder_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" text DEFAULT 'fake' NOT NULL,
	"pushed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	CONSTRAINT "wallet_passes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "wallet_passes_status_check" CHECK (status in ('active', 'voided')),
	CONSTRAINT "wallet_passes_provider_check" CHECK (provider in ('fake', 'apple', 'google')),
	CONSTRAINT "wallet_passes_voided_check" CHECK ((status = 'voided') = (voided_at is not null))
);
--> statement-breakpoint
ALTER TABLE "ticketing"."wallet_passes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."wallet_passes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."disputes" ADD COLUMN "deadline_alert_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "transfers_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "transfer_cutoff_hours" integer;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD COLUMN "transfer_fee_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."credit_note_applications" ADD CONSTRAINT "credit_note_applications_note_fk" FOREIGN KEY ("org_id","credit_note_id") REFERENCES "orders"."credit_notes"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."credit_note_applications" ADD CONSTRAINT "credit_note_applications_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."credit_notes" ADD CONSTRAINT "credit_notes_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."support_macro_runs" ADD CONSTRAINT "support_macro_runs_macro_fk" FOREIGN KEY ("org_id","macro_id") REFERENCES "orders"."support_macros"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."support_macro_runs" ADD CONSTRAINT "support_macro_runs_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_transfers" ADD CONSTRAINT "ticket_transfers_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_transfers" ADD CONSTRAINT "ticket_transfers_claim_fk" FOREIGN KEY ("org_id","claim_id") REFERENCES "ticketing"."ticket_claims"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketing"."wallet_passes" ADD CONSTRAINT "wallet_passes_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_note_applications_org_id_idx" ON "orders"."credit_note_applications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "credit_note_applications_org_note_idx" ON "orders"."credit_note_applications" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_applications_org_order_key" ON "orders"."credit_note_applications" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "credit_note_sequences_org_id_idx" ON "orders"."credit_note_sequences" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_sequences_org_key" ON "orders"."credit_note_sequences" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "credit_notes_org_id_idx" ON "orders"."credit_notes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_org_number_key" ON "orders"."credit_notes" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_org_code_key" ON "orders"."credit_notes" USING btree ("org_id","code") WHERE code is not null;--> statement-breakpoint
CREATE INDEX "credit_notes_org_order_idx" ON "orders"."credit_notes" USING btree ("org_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_notes_org_created_idx" ON "orders"."credit_notes" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "support_macro_runs_org_id_idx" ON "orders"."support_macro_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "support_macro_runs_org_order_idx" ON "orders"."support_macro_runs" USING btree ("org_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "support_macros_org_id_idx" ON "orders"."support_macros" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_macros_org_name_key" ON "orders"."support_macros" USING btree ("org_id",lower("name")) WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "ticket_transfers_org_id_idx" ON "ticketing"."ticket_transfers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ticket_transfers_org_order_idx" ON "ticketing"."ticket_transfers" USING btree ("org_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_transfers_org_ticket_idx" ON "ticketing"."ticket_transfers" USING btree ("org_id","ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_transfers_org_claim_key" ON "ticketing"."ticket_transfers" USING btree ("org_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_transfers_org_ticket_pending_key" ON "ticketing"."ticket_transfers" USING btree ("org_id","ticket_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "wallet_passes_org_id_idx" ON "ticketing"."wallet_passes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_passes_org_ticket_rev_key" ON "ticketing"."wallet_passes" USING btree ("org_id","ticket_id","rev");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_passes_org_serial_key" ON "ticketing"."wallet_passes" USING btree ("org_id","serial");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_passes_org_ticket_active_key" ON "ticketing"."wallet_passes" USING btree ("org_id","ticket_id") WHERE status = 'active';--> statement-breakpoint
-- hand-written: begin (M3.10c: CHECKs on existing tables added NOT VALID, then validated)
ALTER TABLE "payments"."disputes" ADD CONSTRAINT "disputes_deadline_alert_check" CHECK (deadline_alert_level between 0 and 2) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments"."disputes" VALIDATE CONSTRAINT "disputes_deadline_alert_check";--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ADD CONSTRAINT "ticket_types_transfer_rules_check" CHECK (transfer_fee_minor >= 0 and (transfer_cutoff_hours is null or transfer_cutoff_hours between 0 and 8760)) NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" VALIDATE CONSTRAINT "ticket_types_transfer_rules_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "credit_note_applications_tenant_isolation" ON "orders"."credit_note_applications" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "credit_note_sequences_tenant_isolation" ON "orders"."credit_note_sequences" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "credit_notes_tenant_isolation" ON "orders"."credit_notes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "support_macro_runs_tenant_isolation" ON "orders"."support_macro_runs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "support_macros_tenant_isolation" ON "orders"."support_macros" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "ticket_transfers_tenant_isolation" ON "ticketing"."ticket_transfers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "wallet_passes_tenant_isolation" ON "ticketing"."wallet_passes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M3.10c cross-module FKs, down the tiers (orders 4 → events 2, ticketing 3 → events 2); new
-- tables, so no NOT VALID needed.
ALTER TABLE "orders"."credit_notes" ADD CONSTRAINT "credit_notes_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_transfers" ADD CONSTRAINT "ticket_transfers_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");
-- hand-written: end
