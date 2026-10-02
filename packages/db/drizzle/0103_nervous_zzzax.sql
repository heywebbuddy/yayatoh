ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "source" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "email_sealed" text;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "export_key" text;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "export_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "receipt" jsonb;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "dsar_requests_org_open_subject_key" ON "privacy"."dsar_requests" USING btree ("org_id","subject_ref") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "dsar_requests_org_due_idx" ON "privacy"."dsar_requests" USING btree ("org_id","due_at") WHERE status = 'open';--> statement-breakpoint
-- hand-written: begin (M6.1c DSAR propagation)
-- CHECKs on an existing table are added NOT VALID, then validated (no long lock).
ALTER TABLE "privacy"."dsar_requests" ADD CONSTRAINT "dsar_requests_status_check" CHECK (status in ('open', 'completed', 'cancelled')) NOT VALID;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD CONSTRAINT "dsar_requests_source_check" CHECK (source in ('staff', 'self')) NOT VALID;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD CONSTRAINT "dsar_requests_open_check" CHECK ((status = 'open') = (completed_at is null and cancelled_at is null) and (status = 'open' or email_sealed is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ADD CONSTRAINT "dsar_requests_self_verified_check" CHECK (source = 'staff' or verified_at is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" VALIDATE CONSTRAINT "dsar_requests_status_check";--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" VALIDATE CONSTRAINT "dsar_requests_source_check";--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" VALIDATE CONSTRAINT "dsar_requests_open_check";--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" VALIDATE CONSTRAINT "dsar_requests_self_verified_check";--> statement-breakpoint
-- Erasure (M6.1c) redacts the person from the outbox log. The app may only append to it, so a
-- SECURITY DEFINER function rewrites matching string values (never keys or structure) in this
-- org's events only: the org comes from the caller's tenant transaction, never from an argument.
CREATE FUNCTION platform.redact_jsonb(p jsonb, p_pattern text, p_replacement text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE jsonb_typeof(p)
    WHEN 'string' THEN to_jsonb(regexp_replace(p #>> '{}', p_pattern, p_replacement, 'gi'))
    WHEN 'object' THEN (
      SELECT coalesce(jsonb_object_agg(x.k, platform.redact_jsonb(x.v, p_pattern, p_replacement)), '{}'::jsonb)
      FROM jsonb_each(p) AS x(k, v))
    WHEN 'array' THEN (
      SELECT coalesce(jsonb_agg(platform.redact_jsonb(x.v, p_pattern, p_replacement) ORDER BY x.i), '[]'::jsonb)
      FROM jsonb_array_elements(p) WITH ORDINALITY AS x(v, i))
    ELSE p
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.redact_jsonb(jsonb, text, text) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION platform.redact_subject_events(p_needles text[], p_replacement text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_pattern text;
  v_count integer;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'platform.redact_subject_events needs a tenant transaction';
  END IF;
  SELECT string_agg(regexp_replace(n, '([.*+?^${}()|\[\]\\])', '\\\1', 'g'), '|')
    INTO v_pattern
    FROM unnest(p_needles) AS n
   WHERE length(btrim(n)) >= 3;
  IF v_pattern IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE platform.domain_events e
     SET payload = platform.redact_jsonb(e.payload, v_pattern, p_replacement)
   WHERE e.org_id = v_org AND e.payload::text ~* v_pattern;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.redact_subject_events(text[], text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.redact_subject_events(text[], text) TO app_user;
-- hand-written: end
