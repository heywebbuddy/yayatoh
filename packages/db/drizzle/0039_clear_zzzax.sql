CREATE SCHEMA "privacy";
--> statement-breakpoint
CREATE TABLE "platform"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_ms" integer NOT NULL,
	"window_start" bigint NOT NULL,
	"prev" integer DEFAULT 0 NOT NULL,
	"curr" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy"."dsar_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"subject_ref" text NOT NULL,
	"subject_hint" text NOT NULL,
	"requested_by" uuid,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"operation_id" uuid,
	"completed_at" timestamp with time zone,
	CONSTRAINT "dsar_requests_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "dsar_requests_kind_check" CHECK (kind in ('access', 'erasure')),
	CONSTRAINT "dsar_requests_subject_ref_check" CHECK (subject_ref ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "privacy"."dsar_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."audit_events" ADD COLUMN "seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."audit_events" ADD COLUMN "prev_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."audit_events" ADD COLUMN "hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- hand-written: begin (M1.14b audit hash chain; must run before audit_events_org_seq_key is created)
CREATE FUNCTION platform.audit_hash(
  p_prev text, p_org uuid, p_seq bigint, p_actor text, p_action text, p_target_type text,
  p_target_id text, p_data jsonb, p_request_id text, p_at timestamptz
) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    p_prev, p_org, p_seq, p_actor, p_action, p_target_type, p_target_id, p_data, p_request_id,
    (extract(epoch FROM p_at) * 1000000)::bigint
  )::text, 'UTF8')), 'hex')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.audit_hash(text, uuid, bigint, text, text, text, text, jsonb, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.audit_hash(text, uuid, bigint, text, text, text, text, jsonb, text, timestamptz) TO app_user, platform_reader;
--> statement-breakpoint
-- Chain each org's entries: a per-org advisory lock serializes appends, the latest committed
-- entry supplies seq and prev_hash (a fresh snapshot per statement under READ COMMITTED).
-- SECURITY INVOKER: under app_user, RLS scopes the lookup to the row's own org.
CREATE FUNCTION platform.audit_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  last_seq bigint;
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform.audit_events:' || NEW.org_id::text, 0));
  SELECT a.seq, a.hash INTO last_seq, last_hash
    FROM platform.audit_events a WHERE a.org_id = NEW.org_id ORDER BY a.seq DESC LIMIT 1;
  NEW.created_at := coalesce(NEW.created_at, now());
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := coalesce(last_hash, '');
  NEW.hash := platform.audit_hash(NEW.prev_hash, NEW.org_id, NEW.seq, NEW.actor, NEW.action,
    NEW.target_type, NEW.target_id, NEW.data, NEW.request_id, NEW.created_at);
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Backfill existing entries in (created_at, id) order per org.
DO $$
DECLARE
  r record;
  v_org uuid := NULL;
  v_prev text := '';
  v_seq bigint := 0;
BEGIN
  FOR r IN SELECT id, org_id, actor, action, target_type, target_id, data, request_id, created_at
           FROM platform.audit_events ORDER BY org_id, created_at, id LOOP
    IF v_org IS DISTINCT FROM r.org_id THEN
      v_org := r.org_id; v_prev := ''; v_seq := 0;
    END IF;
    v_seq := v_seq + 1;
    UPDATE platform.audit_events
       SET seq = v_seq, prev_hash = v_prev,
           hash = platform.audit_hash(v_prev, r.org_id, v_seq, r.actor, r.action, r.target_type,
                                      r.target_id, r.data, r.request_id, r.created_at)
     WHERE id = r.id
     RETURNING hash INTO v_prev;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_chain BEFORE INSERT ON platform.audit_events
  FOR EACH ROW EXECUTE FUNCTION platform.audit_chain();
--> statement-breakpoint
ALTER TABLE platform.audit_events ADD CONSTRAINT audit_events_chain_check
  CHECK (seq >= 1 AND hash ~ '^[0-9a-f]{64}$' AND (prev_hash = '' OR prev_hash ~ '^[0-9a-f]{64}$')) NOT VALID;
--> statement-breakpoint
ALTER TABLE platform.audit_events VALIDATE CONSTRAINT audit_events_chain_check;
--> statement-breakpoint
-- hand-written: end
CREATE INDEX "rate_limits_expires_idx" ON "platform"."rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "dsar_requests_org_id_idx" ON "privacy"."dsar_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "dsar_requests_org_created_idx" ON "privacy"."dsar_requests" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "dsar_requests_org_subject_idx" ON "privacy"."dsar_requests" USING btree ("org_id","subject_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_org_seq_key" ON "platform"."audit_events" USING btree ("org_id","seq");--> statement-breakpoint
CREATE INDEX "audit_events_org_actor_seq_idx" ON "platform"."audit_events" USING btree ("org_id","actor","seq");--> statement-breakpoint
CREATE INDEX "audit_events_org_action_seq_idx" ON "platform"."audit_events" USING btree ("org_id","action","seq");--> statement-breakpoint
CREATE POLICY "dsar_requests_tenant_isolation" ON "privacy"."dsar_requests" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin (M1.14a rate limiter; global, UNLOGGED, no app_user table privileges)
ALTER TABLE platform.rate_limits SET UNLOGGED;
--> statement-breakpoint
REVOKE ALL ON platform.rate_limits FROM app_user;
--> statement-breakpoint
-- The sliding-window counter of packages/platform/src/security/rate-limit.ts (slidingWindow),
-- atomic per key. Denied hits are not counted.
CREATE FUNCTION platform.rate_limit_hit(p_key text, p_limit integer, p_window_ms integer, p_now_ms bigint)
RETURNS TABLE (allowed boolean, remaining integer, retry_after_ms integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  s record;
  v_start bigint;
  v_prev integer := 0;
  v_curr integer := 0;
  v_elapsed bigint;
  v_est double precision;
  v_room integer;
  v_dt double precision;
  v_t double precision := 0;
  v_expires timestamptz;
BEGIN
  IF p_limit < 1 OR p_window_ms < 1 OR p_now_ms < 0 OR length(p_key) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid arguments' USING ERRCODE = '22023';
  END IF;
  v_start := (p_now_ms / p_window_ms) * p_window_ms;
  v_expires := to_timestamp((v_start + 2 * p_window_ms) / 1000.0);
  INSERT INTO platform.rate_limits (key, window_ms, window_start, prev, curr, expires_at)
    VALUES (p_key, p_window_ms, v_start, 0, 0, v_expires)
    ON CONFLICT (key) DO NOTHING;
  SELECT * INTO s FROM platform.rate_limits r WHERE r.key = p_key FOR UPDATE;
  IF s.window_ms = p_window_ms THEN
    IF s.window_start = v_start THEN
      v_prev := s.prev; v_curr := s.curr;
    ELSIF s.window_start = v_start - p_window_ms THEN
      v_prev := s.curr;
    END IF;
  END IF;
  v_elapsed := p_now_ms - v_start;
  v_est := v_prev * (1 - v_elapsed::double precision / p_window_ms) + v_curr;
  IF v_est + 1 <= p_limit THEN
    UPDATE platform.rate_limits r SET window_ms = p_window_ms, window_start = v_start, prev = v_prev,
      curr = v_curr + 1, expires_at = v_expires WHERE r.key = p_key;
    RETURN QUERY SELECT true, greatest(0, floor(p_limit - v_est - 1))::integer, 0;
    RETURN;
  END IF;
  UPDATE platform.rate_limits r SET window_ms = p_window_ms, window_start = v_start, prev = v_prev,
    curr = v_curr, expires_at = v_expires WHERE r.key = p_key;
  v_room := p_limit - 1 - v_curr;
  IF v_prev > 0 AND v_room >= 0 THEN
    v_dt := p_window_ms * (1 - v_room::double precision / v_prev) - v_elapsed;
    IF v_dt < p_window_ms - v_elapsed THEN
      RETURN QUERY SELECT false, 0, greatest(1, ceil(v_dt))::integer;
      RETURN;
    END IF;
  END IF;
  IF v_curr > p_limit - 1 THEN
    v_t := p_window_ms * (1 - (p_limit - 1)::double precision / v_curr);
  END IF;
  RETURN QUERY SELECT false, 0, greatest(1, ceil(p_window_ms - v_elapsed + v_t))::integer;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.rate_limit_hit(text, integer, integer, bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.rate_limit_hit(text, integer, integer, bigint) TO app_user;
--> statement-breakpoint
-- Retention: drop counters whose window has passed (worker, every few minutes).
CREATE FUNCTION platform.purge_rate_limits() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH d AS (DELETE FROM platform.rate_limits WHERE expires_at < now() RETURNING 1)
  SELECT count(*)::integer FROM d
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.purge_rate_limits() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.purge_rate_limits() TO app_user, platform_reader;
-- hand-written: end
