CREATE TABLE "payments"."journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"memo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "journal_entries_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "payments"."journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."journal_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments"."postings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "postings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "postings_account_check" CHECK (account in ('platform:stripe_cash', 'platform:platform_fee_deferred', 'platform:platform_fee_revenue', 'platform:processing_fee_expense', 'org:payable_held', 'org:payable_releasable', 'org:reserve', 'org:receivable')),
	CONSTRAINT "postings_amount_check" CHECK (amount_minor <> 0),
	CONSTRAINT "postings_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "payments"."postings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."postings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."postings" ADD CONSTRAINT "postings_journal_fk" FOREIGN KEY ("org_id","journal_id") REFERENCES "payments"."journal_entries"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_org_id_idx" ON "payments"."journal_entries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_key" ON "payments"."journal_entries" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "journal_entries_org_ref_idx" ON "payments"."journal_entries" USING btree ("org_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "postings_org_id_idx" ON "payments"."postings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "postings_org_account_idx" ON "payments"."postings" USING btree ("org_id","account","currency");--> statement-breakpoint
CREATE INDEX "postings_org_journal_idx" ON "payments"."postings" USING btree ("org_id","journal_id");--> statement-breakpoint
CREATE POLICY "journal_entries_tenant_isolation" ON "payments"."journal_entries" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "postings_tenant_isolation" ON "payments"."postings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- Ledger (roadmap §5.3): immutable. app_user may only read its org's rows; ledger_writer (NOLOGIN,
-- owner of post_journal) may only read and insert, still under the same org policy.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON payments.journal_entries, payments.postings FROM app_user;--> statement-breakpoint
GRANT USAGE ON SCHEMA payments TO ledger_writer;--> statement-breakpoint
GRANT SELECT, INSERT ON payments.journal_entries, payments.postings TO ledger_writer;--> statement-breakpoint
CREATE POLICY "journal_entries_ledger_writer" ON "payments"."journal_entries" AS PERMISSIVE FOR ALL TO "ledger_writer" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "postings_ledger_writer" ON "payments"."postings" AS PERMISSIVE FOR ALL TO "ledger_writer" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- Post one balanced journal for the current org. p_postings: [{"account", "amount", "currency"}].
-- Refuses: another org, no postings, a zero line, or any currency that does not sum to zero.
-- Idempotent: the same key returns the first journal (created = false).
CREATE FUNCTION payments.post_journal(
  p_org uuid, p_key text, p_kind text, p_ref_type text, p_ref_id uuid,
  p_occurred_at timestamptz, p_memo jsonb, p_postings jsonb
)
RETURNS TABLE (journal_id uuid, created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid; v_bad text;
BEGIN
  IF p_org IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid THEN
    RAISE EXCEPTION 'post_journal: org mismatch' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_postings) <> 'array' OR jsonb_array_length(p_postings) < 2 THEN
    RAISE EXCEPTION 'post_journal: needs at least two postings' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(c, ', ') INTO v_bad FROM (
    SELECT x->>'currency' AS c FROM jsonb_array_elements(p_postings) x
    GROUP BY x->>'currency' HAVING sum((x->>'amount')::bigint) <> 0
  ) u;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'post_journal: unbalanced in %', v_bad USING ERRCODE = '22023';
  END IF;
  INSERT INTO payments.journal_entries (org_id, idempotency_key, kind, ref_type, ref_id, occurred_at, memo)
  VALUES (p_org, p_key, p_kind, p_ref_type, p_ref_id, p_occurred_at, coalesce(p_memo, '{}'::jsonb))
  ON CONFLICT (org_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT j.id INTO v_id FROM payments.journal_entries j WHERE j.org_id = p_org AND j.idempotency_key = p_key;
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END IF;
  INSERT INTO payments.postings (org_id, journal_id, account, amount_minor, currency)
  SELECT p_org, v_id, x->>'account', (x->>'amount')::bigint, x->>'currency'
  FROM jsonb_array_elements(p_postings) x;
  RETURN QUERY SELECT v_id, true;
END
$$;
--> statement-breakpoint
-- Changing the owner needs CREATE on the schema for the new owner: grant it only for this step.
GRANT CREATE ON SCHEMA payments TO ledger_writer;--> statement-breakpoint
ALTER FUNCTION payments.post_journal(uuid, text, text, text, uuid, timestamptz, jsonb, jsonb) OWNER TO ledger_writer;--> statement-breakpoint
REVOKE CREATE ON SCHEMA payments FROM ledger_writer;--> statement-breakpoint
REVOKE ALL ON FUNCTION payments.post_journal(uuid, text, text, text, uuid, timestamptz, jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION payments.post_journal(uuid, text, text, text, uuid, timestamptz, jsonb, jsonb) TO app_user;
