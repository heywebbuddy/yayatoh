CREATE TABLE "platform"."ops_flag_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"reason" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ops_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_flags_key_check" CHECK (key = 'read_only_freeze' or key ~ '^host_route:[a-z0-9.-]{1,253}$'),
	CONSTRAINT "ops_flags_reason_check" CHECK (length(reason) <= 500)
);
--> statement-breakpoint
CREATE INDEX "ops_flag_changes_key_at_idx" ON "platform"."ops_flag_changes" USING btree ("key","at");--> statement-breakpoint
-- hand-written: begin (M2.5a: ops flags are reached only through these SECURITY DEFINER functions)
REVOKE ALL ON platform.ops_flags FROM app_user;--> statement-breakpoint
REVOKE ALL ON platform.ops_flag_changes FROM app_user;--> statement-breakpoint
REVOKE ALL ON platform.ops_flags FROM platform_reader;--> statement-breakpoint
REVOKE ALL ON platform.ops_flag_changes FROM platform_reader;--> statement-breakpoint
GRANT SELECT ON platform.ops_flags TO platform_reader;--> statement-breakpoint
GRANT SELECT ON platform.ops_flag_changes TO platform_reader;--> statement-breakpoint
-- The read-only freeze, if on: platform-wide or for the listed orgs. No row when off.
CREATE FUNCTION platform.read_only_freeze()
RETURNS TABLE (scope text, org_ids uuid[], since timestamptz, expected_end_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT f.value->>'scope',
         CASE WHEN f.value->>'scope' = 'orgs'
              THEN ARRAY(SELECT jsonb_array_elements_text(f.value->'orgIds'))::uuid[] ELSE '{}'::uuid[] END,
         f.updated_at,
         (f.value->>'expectedEndAt')::timestamptz
  FROM platform.ops_flags f WHERE f.key = 'read_only_freeze'
$$;
--> statement-breakpoint
-- Where a host's traffic goes during the cutover ('next' or 'legacy'); null when not routed.
CREATE FUNCTION platform.host_route(p_host text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT f.value->>'target' FROM platform.ops_flags f WHERE f.key = 'host_route:' || lower(p_host)
$$;
--> statement-breakpoint
-- Set (or clear, with a null value) one flag and append the change. Shapes are checked here too.
CREATE FUNCTION platform.set_ops_flag(p_key text, p_value jsonb, p_reason text, p_actor text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR length(p_actor) = 0 OR length(p_actor) > 200 THEN
    RAISE EXCEPTION 'ops flag actor required' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NOT NULL AND p_key = 'read_only_freeze' AND NOT (
       (p_value->>'scope' = 'platform')
       OR (p_value->>'scope' = 'orgs' AND jsonb_typeof(p_value->'orgIds') = 'array'
           AND jsonb_array_length(p_value->'orgIds') BETWEEN 1 AND 1000)) THEN
    RAISE EXCEPTION 'invalid read_only_freeze value' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NOT NULL AND p_key LIKE 'host\_route:%' AND coalesce(p_value->>'target', '') NOT IN ('next', 'legacy') THEN
    RAISE EXCEPTION 'invalid host_route value' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL THEN
    DELETE FROM platform.ops_flags WHERE key = p_key;
  ELSE
    INSERT INTO platform.ops_flags (key, value, reason, updated_by, updated_at)
    VALUES (p_key, p_value, coalesce(p_reason, ''), p_actor, now())
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, reason = excluded.reason,
      updated_by = excluded.updated_by,
      -- "since" stays the first time the flag went on while only its details change.
      updated_at = CASE WHEN platform.ops_flags.value->>'scope' IS NOT DISTINCT FROM excluded.value->>'scope'
                         AND platform.ops_flags.key = 'read_only_freeze' THEN platform.ops_flags.updated_at ELSE now() END;
  END IF;
  INSERT INTO platform.ops_flag_changes (key, value, reason, actor) VALUES (p_key, p_value, coalesce(p_reason, ''), p_actor);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.read_only_freeze() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.host_route(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.set_ops_flag(text, jsonb, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.read_only_freeze() TO app_user, platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.host_route(text) TO app_user, platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.set_ops_flag(text, jsonb, text, text) TO platform_reader;
-- hand-written: end
