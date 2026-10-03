CREATE TABLE "donations"."charity_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legal_name" text NOT NULL,
	"ein" text NOT NULL,
	"exempt_kind" text NOT NULL,
	"sponsor_name" text,
	"sponsor_ein" text,
	"address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_note" text,
	"irs_name" text,
	"irs_city" text,
	"irs_state" text,
	"irs_deductibility" text,
	CONSTRAINT "charity_profiles_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "charity_profiles_legal_name_length" CHECK (length(legal_name) between 1 and 200),
	CONSTRAINT "charity_profiles_ein_check" CHECK (ein ~ '^[0-9]{2}-[0-9]{7}$'),
	CONSTRAINT "charity_profiles_exempt_kind_check" CHECK (exempt_kind in ('501c3', 'fiscal_sponsor')),
	CONSTRAINT "charity_profiles_sponsor_check" CHECK ((exempt_kind = 'fiscal_sponsor') = (sponsor_name is not null and sponsor_ein is not null) and (exempt_kind = 'fiscal_sponsor' or (sponsor_name is null and sponsor_ein is null))),
	CONSTRAINT "charity_profiles_sponsor_name_length" CHECK (sponsor_name is null or length(sponsor_name) between 1 and 200),
	CONSTRAINT "charity_profiles_sponsor_ein_check" CHECK (sponsor_ein is null or sponsor_ein ~ '^[0-9]{2}-[0-9]{7}$'),
	CONSTRAINT "charity_profiles_address_length" CHECK (address is null or length(address) between 1 and 300),
	CONSTRAINT "charity_profiles_status_check" CHECK (status in ('pending', 'verified', 'rejected')),
	CONSTRAINT "charity_profiles_version_check" CHECK (version >= 1),
	CONSTRAINT "charity_profiles_review_check" CHECK ((status = 'pending') = (reviewed_at is null) and (status <> 'verified' or irs_name is not null)),
	CONSTRAINT "charity_profiles_review_note_length" CHECK (review_note is null or length(review_note) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "donations"."charity_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."charity_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."receipt_sequences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "receipt_sequences_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "receipt_sequences_last_check" CHECK (last_number >= 0)
);
--> statement-breakpoint
ALTER TABLE "donations"."receipt_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."receipt_sequences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"gift_id" uuid,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"deductible" boolean NOT NULL,
	"donor_name" text NOT NULL,
	"donor_email" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fmv_minor" bigint NOT NULL,
	"deductible_minor" bigint NOT NULL,
	"goods" text,
	"charity_name" text NOT NULL,
	"charity_ein" text,
	"sponsor_name" text,
	"sponsor_ein" text,
	"charity_address" text,
	"paid_at" timestamp with time zone NOT NULL,
	"tax_year" integer NOT NULL,
	"copy_version" text NOT NULL,
	CONSTRAINT "receipts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "receipts_number_check" CHECK (number >= 1),
	CONSTRAINT "receipts_kind_check" CHECK (kind in ('gift', 'ticket')),
	CONSTRAINT "receipts_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "receipts_amounts_check" CHECK (amount_minor >= 0 and fmv_minor >= 0 and deductible_minor >= 0 and deductible_minor <= amount_minor),
	CONSTRAINT "receipts_deductible_check" CHECK (deductible or deductible_minor = 0),
	CONSTRAINT "receipts_charity_check" CHECK (not deductible or charity_ein is not null),
	CONSTRAINT "receipts_donor_name_length" CHECK (length(donor_name) between 1 and 120),
	CONSTRAINT "receipts_donor_email_check" CHECK (donor_email = lower(donor_email) and length(donor_email) <= 254),
	CONSTRAINT "receipts_goods_length" CHECK (goods is null or length(goods) between 1 and 2000),
	CONSTRAINT "receipts_charity_name_length" CHECK (length(charity_name) between 1 and 200),
	CONSTRAINT "receipts_tax_year_check" CHECK (tax_year between 2000 and 2200)
);
--> statement-breakpoint
ALTER TABLE "donations"."receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."ticket_fair_values" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"fmv_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text,
	CONSTRAINT "ticket_fair_values_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "ticket_fair_values_fmv_check" CHECK (fmv_minor >= 0 and fmv_minor <= 100000000),
	CONSTRAINT "ticket_fair_values_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "ticket_fair_values_description_length" CHECK (description is null or length(description) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "donations"."ticket_fair_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."ticket_fair_values" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."year_end_statements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tax_year" integer NOT NULL,
	"donor_email" text NOT NULL,
	"donor_name" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"currency" text NOT NULL,
	"receipt_count" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fmv_minor" bigint NOT NULL,
	"deductible_minor" bigint NOT NULL,
	"charity_name" text NOT NULL,
	"charity_ein" text NOT NULL,
	"sponsor_name" text,
	"sponsor_ein" text,
	"charity_address" text,
	"copy_version" text NOT NULL,
	CONSTRAINT "year_end_statements_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "year_end_statements_tax_year_check" CHECK (tax_year between 2000 and 2200),
	CONSTRAINT "year_end_statements_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "year_end_statements_count_check" CHECK (receipt_count >= 1),
	CONSTRAINT "year_end_statements_amounts_check" CHECK (amount_minor >= 0 and fmv_minor >= 0 and deductible_minor >= 0 and deductible_minor <= amount_minor),
	CONSTRAINT "year_end_statements_donor_email_check" CHECK (donor_email = lower(donor_email) and length(donor_email) <= 254),
	CONSTRAINT "year_end_statements_donor_name_length" CHECK (length(donor_name) between 1 and 120),
	CONSTRAINT "year_end_statements_charity_name_length" CHECK (length(charity_name) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "donations"."year_end_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."year_end_statements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "charity_profiles_org_id_idx" ON "donations"."charity_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charity_profiles_org_key" ON "donations"."charity_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "charity_profiles_org_status_idx" ON "donations"."charity_profiles" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "receipt_sequences_org_id_idx" ON "donations"."receipt_sequences" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_sequences_org_key" ON "donations"."receipt_sequences" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "receipts_org_id_idx" ON "donations"."receipts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_org_order_key" ON "donations"."receipts" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_org_number_key" ON "donations"."receipts" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "receipts_org_event_created_idx" ON "donations"."receipts" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "receipts_org_year_email_idx" ON "donations"."receipts" USING btree ("org_id","tax_year","donor_email");--> statement-breakpoint
CREATE INDEX "ticket_fair_values_org_id_idx" ON "donations"."ticket_fair_values" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_fair_values_org_type_key" ON "donations"."ticket_fair_values" USING btree ("org_id","ticket_type_id");--> statement-breakpoint
CREATE INDEX "ticket_fair_values_org_event_idx" ON "donations"."ticket_fair_values" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "year_end_statements_org_id_idx" ON "donations"."year_end_statements" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "year_end_statements_org_year_email_key" ON "donations"."year_end_statements" USING btree ("org_id","tax_year","donor_email","currency");--> statement-breakpoint
CREATE INDEX "year_end_statements_org_year_idx" ON "donations"."year_end_statements" USING btree ("org_id","tax_year");--> statement-breakpoint
CREATE POLICY "charity_profiles_tenant_isolation" ON "donations"."charity_profiles" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "receipt_sequences_tenant_isolation" ON "donations"."receipt_sequences" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "receipts_tenant_isolation" ON "donations"."receipts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "ticket_fair_values_tenant_isolation" ON "donations"."ticket_fair_values" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "year_end_statements_tenant_isolation" ON "donations"."year_end_statements" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.8b cross-module composite FKs (donations is tier 5; events tier 2, ticketing tier 3, orders
-- tier 4). A fair-market value goes with its ticket type and event; a receipt keeps its order and
-- event (tax records: an order or event with receipts cannot be deleted).
ALTER TABLE "donations"."ticket_fair_values" ADD CONSTRAINT "ticket_fair_values_ticket_type_fk" FOREIGN KEY ("org_id","ticket_type_id") REFERENCES "ticketing"."ticket_types"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."ticket_fair_values" ADD CONSTRAINT "ticket_fair_values_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."receipts" ADD CONSTRAINT "receipts_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id");--> statement-breakpoint
ALTER TABLE "donations"."receipts" ADD CONSTRAINT "receipts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "donations"."receipts" ADD CONSTRAINT "receipts_gift_fk" FOREIGN KEY ("org_id","gift_id") REFERENCES "donations"."gifts"("org_id","id");
-- hand-written: end
