CREATE TABLE "donations"."recon_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"currency" text NOT NULL,
	"ledger_minor" bigint NOT NULL,
	"provider_minor" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "recon_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "recon_items_kind_check" CHECK (kind in ('missing_at_provider', 'missing_in_ledger', 'amount_mismatch')),
	CONSTRAINT "recon_items_status_check" CHECK (status in ('open', 'resolved', 'cleared')),
	CONSTRAINT "recon_items_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "recon_items_reference_length" CHECK (length(reference) between 1 and 200),
	CONSTRAINT "recon_items_resolved_check" CHECK (status <> 'resolved' or (resolved_at is not null and resolution_note is not null)),
	CONSTRAINT "recon_items_note_length" CHECK (resolution_note is null or length(resolution_note) between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "donations"."recon_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."recon_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."recon_payouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"payout_id" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"arrival_date" date NOT NULL,
	"payout_created_at" timestamp with time zone NOT NULL,
	"donation_gross_minor" bigint NOT NULL,
	"donation_fee_minor" bigint NOT NULL,
	"donation_count" integer NOT NULL,
	CONSTRAINT "recon_payouts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "recon_payouts_status_check" CHECK (status in ('pending', 'in_transit', 'paid', 'failed', 'canceled')),
	CONSTRAINT "recon_payouts_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "recon_payouts_payout_id_length" CHECK (length(payout_id) between 1 and 200),
	CONSTRAINT "recon_payouts_count_check" CHECK (donation_count >= 0 and donation_fee_minor >= 0)
);
--> statement-breakpoint
ALTER TABLE "donations"."recon_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."recon_payouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."recon_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"ledger_count" integer NOT NULL,
	"provider_count" integer NOT NULL,
	"item_count" integer NOT NULL,
	"totals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ran_by" text,
	CONSTRAINT "recon_runs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "recon_runs_provider_check" CHECK (provider in ('fake', 'stripe')),
	CONSTRAINT "recon_runs_counts_check" CHECK (ledger_count >= 0 and provider_count >= 0 and item_count >= 0)
);
--> statement-breakpoint
ALTER TABLE "donations"."recon_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."recon_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."recon_items" ADD CONSTRAINT "recon_items_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "donations"."recon_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."recon_payouts" ADD CONSTRAINT "recon_payouts_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "donations"."recon_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recon_items_org_id_idx" ON "donations"."recon_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_items_org_event_reference_key" ON "donations"."recon_items" USING btree ("org_id","event_id","reference","currency");--> statement-breakpoint
CREATE INDEX "recon_items_org_event_status_idx" ON "donations"."recon_items" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "recon_payouts_org_id_idx" ON "donations"."recon_payouts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_payouts_org_run_payout_key" ON "donations"."recon_payouts" USING btree ("org_id","run_id","payout_id");--> statement-breakpoint
CREATE INDEX "recon_payouts_org_event_idx" ON "donations"."recon_payouts" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "recon_runs_org_id_idx" ON "donations"."recon_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "recon_runs_org_event_created_idx" ON "donations"."recon_runs" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE POLICY "recon_items_tenant_isolation" ON "donations"."recon_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "recon_payouts_tenant_isolation" ON "donations"."recon_payouts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "recon_runs_tenant_isolation" ON "donations"."recon_runs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.8g cross-module composite FKs (donations is tier 5, events tier 2): a reconciliation belongs to
-- its event and goes with it (it holds no money, only what each side counted).
ALTER TABLE "donations"."recon_runs" ADD CONSTRAINT "recon_runs_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."recon_items" ADD CONSTRAINT "recon_items_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."recon_payouts" ADD CONSTRAINT "recon_payouts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- M4.8g memo entries: a gift is a direct charge on the charity's connected account with no
-- application fee, so it posts no balanced journal. payments.post_memo is the only writer of a
-- memo-only journal (no postings): org-checked like post_journal, idempotent per key, and limited
-- to the memo kinds so it can never stand in for a money journal.
CREATE FUNCTION payments.post_memo(
  p_org uuid, p_key text, p_kind text, p_ref_type text, p_ref_id uuid,
  p_occurred_at timestamptz, p_memo jsonb, p_event_id uuid
)
RETURNS TABLE (journal_id uuid, created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
  IF p_org IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid THEN
    RAISE EXCEPTION 'post_memo: org mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('donation_memo', 'donation_refund_memo') THEN
    RAISE EXCEPTION 'post_memo: not a memo kind: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_memo) <> 'object' THEN
    RAISE EXCEPTION 'post_memo: memo must be an object' USING ERRCODE = '22023';
  END IF;
  INSERT INTO payments.journal_entries (org_id, idempotency_key, kind, ref_type, ref_id, occurred_at, memo, event_id)
  VALUES (p_org, p_key, p_kind, p_ref_type, p_ref_id, p_occurred_at, p_memo, p_event_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT j.id INTO v_id FROM payments.journal_entries j WHERE j.org_id = p_org AND j.idempotency_key = p_key;
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END IF;
  RETURN QUERY SELECT v_id, true;
END
$$;--> statement-breakpoint
GRANT CREATE ON SCHEMA payments TO ledger_writer;--> statement-breakpoint
ALTER FUNCTION payments.post_memo(uuid, text, text, text, uuid, timestamptz, jsonb, uuid) OWNER TO ledger_writer;--> statement-breakpoint
REVOKE CREATE ON SCHEMA payments FROM ledger_writer;--> statement-breakpoint
REVOKE ALL ON FUNCTION payments.post_memo(uuid, text, text, text, uuid, timestamptz, jsonb, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION payments.post_memo(uuid, text, text, text, uuid, timestamptz, jsonb, uuid) TO app_user;
-- hand-written: end
