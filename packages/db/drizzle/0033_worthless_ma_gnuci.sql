CREATE TABLE "payments"."settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"event_id" uuid,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"released_minor" bigint NOT NULL,
	"reserve_minor" bigint DEFAULT 0 NOT NULL,
	"netted_minor" bigint DEFAULT 0 NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reserve_release_at" timestamp with time zone,
	"reserve_released_at" timestamp with time zone,
	"destination_account_id" text,
	"transfer_id" text,
	"failure" text,
	"released_at" timestamp with time zone NOT NULL,
	"transferred_at" timestamp with time zone,
	CONSTRAINT "settlements_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "settlements_kind_check" CHECK (kind in ('event', 'reserve')),
	CONSTRAINT "settlements_status_check" CHECK (status in ('ready', 'waiting_account', 'transferred', 'failed')),
	CONSTRAINT "settlements_amounts_check" CHECK (released_minor >= 0 and reserve_minor >= 0 and netted_minor >= 0 and amount_minor >= 0 and amount_minor = released_minor - reserve_minor - netted_minor)
);
--> statement-breakpoint
ALTER TABLE "payments"."settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."settlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."journal_entries" ADD COLUMN "event_id" uuid;--> statement-breakpoint
CREATE INDEX "settlements_org_id_idx" ON "payments"."settlements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "settlements_org_status_idx" ON "payments"."settlements" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "settlements_org_event_idx" ON "payments"."settlements" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "journal_entries_org_event_idx" ON "payments"."journal_entries" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "settlements_tenant_isolation" ON "payments"."settlements" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- post_journal with the event the money belongs to (settlements release per event). The
-- 8-argument version stays until nothing calls it (expand/contract).
CREATE FUNCTION payments.post_journal(
  p_org uuid, p_key text, p_kind text, p_ref_type text, p_ref_id uuid,
  p_occurred_at timestamptz, p_memo jsonb, p_postings jsonb, p_event_id uuid
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
  INSERT INTO payments.journal_entries (org_id, idempotency_key, kind, ref_type, ref_id, occurred_at, memo, event_id)
  VALUES (p_org, p_key, p_kind, p_ref_type, p_ref_id, p_occurred_at, coalesce(p_memo, '{}'::jsonb), p_event_id)
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
GRANT CREATE ON SCHEMA payments TO ledger_writer;--> statement-breakpoint
ALTER FUNCTION payments.post_journal(uuid, text, text, text, uuid, timestamptz, jsonb, jsonb, uuid) OWNER TO ledger_writer;--> statement-breakpoint
REVOKE CREATE ON SCHEMA payments FROM ledger_writer;--> statement-breakpoint
REVOKE ALL ON FUNCTION payments.post_journal(uuid, text, text, text, uuid, timestamptz, jsonb, jsonb, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION payments.post_journal(uuid, text, text, text, uuid, timestamptz, jsonb, jsonb, uuid) TO app_user;
