CREATE TABLE "platform"."front_door_flag_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"host" text NOT NULL,
	"route" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"table_version" integer NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"stepped_up_at" timestamp with time zone NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "front_door_flag_changes_reason_check" CHECK (length(reason) between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "platform"."front_door_flags" (
	"host" text NOT NULL,
	"route" text NOT NULL,
	"state" text NOT NULL,
	"table_version" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "front_door_flags_pkey" PRIMARY KEY("host","route"),
	CONSTRAINT "front_door_flags_state_check" CHECK (state in ('legacy', 'canary', 'next')),
	CONSTRAINT "front_door_flags_lengths" CHECK (length(host) <= 253 and length(route) <= 60)
);
--> statement-breakpoint
CREATE TABLE "platform"."front_door_not_found" (
	"day" date NOT NULL,
	"host" text NOT NULL,
	"path" text NOT NULL,
	"served_by" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "front_door_not_found_pkey" PRIMARY KEY("day","host","path","served_by"),
	CONSTRAINT "front_door_not_found_served_by_check" CHECK (served_by in ('next', 'legacy')),
	CONSTRAINT "front_door_not_found_path_check" CHECK (length(path) <= 300)
);
--> statement-breakpoint
CREATE TABLE "platform"."front_door_stats" (
	"day" date NOT NULL,
	"host" text NOT NULL,
	"route" text NOT NULL,
	"served_by" text NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"not_found" bigint DEFAULT 0 NOT NULL,
	"proxy_errors" bigint DEFAULT 0 NOT NULL,
	"upstream_5xx" bigint DEFAULT 0 NOT NULL,
	"latency_count" bigint DEFAULT 0 NOT NULL,
	"latency_ms_sum" bigint DEFAULT 0 NOT NULL,
	"latency_ms_max" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "front_door_stats_pkey" PRIMARY KEY("day","host","route","served_by"),
	CONSTRAINT "front_door_stats_served_by_check" CHECK (served_by in ('next', 'legacy'))
);
--> statement-breakpoint
CREATE INDEX "front_door_flag_changes_at_idx" ON "platform"."front_door_flag_changes" USING btree ("at");--> statement-breakpoint
-- hand-written: begin
-- Front door (M2.4a, ADR 0020). Nobody touches these tables directly: the web reads flag states
-- and adds counters through the functions below (app_user); staff read everything and change
-- flags through set_front_door_flag (platform_reader, apps/admin only, audited in access_log).
REVOKE ALL ON platform.front_door_flags FROM app_user;
--> statement-breakpoint
REVOKE ALL ON platform.front_door_flag_changes FROM app_user;
--> statement-breakpoint
REVOKE ALL ON platform.front_door_stats FROM app_user;
--> statement-breakpoint
REVOKE ALL ON platform.front_door_not_found FROM app_user;
--> statement-breakpoint
REVOKE ALL ON platform.front_door_flags FROM platform_reader;
--> statement-breakpoint
REVOKE ALL ON platform.front_door_flag_changes FROM platform_reader;
--> statement-breakpoint
REVOKE ALL ON platform.front_door_stats FROM platform_reader;
--> statement-breakpoint
REVOKE ALL ON platform.front_door_not_found FROM platform_reader;
--> statement-breakpoint
GRANT SELECT ON platform.front_door_flags TO platform_reader;
--> statement-breakpoint
GRANT SELECT ON platform.front_door_flag_changes TO platform_reader;
--> statement-breakpoint
GRANT SELECT ON platform.front_door_stats TO platform_reader;
--> statement-breakpoint
GRANT SELECT ON platform.front_door_not_found TO platform_reader;
--> statement-breakpoint
-- The flag states the proxy routes by (host, route key, state): no actor, reason or time.
CREATE FUNCTION platform.front_door_flags()
RETURNS TABLE (host text, route text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT f.host, f.route, f.state FROM platform.front_door_flags f
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.front_door_flags() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.front_door_flags() TO app_user;
--> statement-breakpoint
-- Change one route's owner on one host. A staff actor, a reason and a step-up from the last ten
-- minutes are required (the console verifies the proof; this re-checks its time). The change and
-- its audit row are written together; returns the previous state.
CREATE FUNCTION platform.set_front_door_flag(
  p_host text, p_route text, p_state text, p_table_version integer, p_actor text, p_reason text,
  p_stepped_up_at timestamptz
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_from text;
BEGIN
  IF p_stepped_up_at IS NULL OR p_stepped_up_at < now() - interval '10 minutes'
     OR p_stepped_up_at > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'front door: a recent step-up is required' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL OR p_actor !~ '^staff:.+' THEN
    RAISE EXCEPTION 'front door: a staff actor is required' USING ERRCODE = '42501';
  END IF;
  IF p_host IS NULL OR p_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' OR length(p_host) > 253 THEN
    RAISE EXCEPTION 'front door: not a host' USING ERRCODE = '22023';
  END IF;
  IF p_route IS NULL OR p_route !~ '^[a-z][a-z0-9.]*$' OR length(p_route) > 60 THEN
    RAISE EXCEPTION 'front door: not a route key' USING ERRCODE = '22023';
  END IF;
  SELECT f.state INTO v_from FROM platform.front_door_flags f
    WHERE f.host = p_host AND f.route = p_route FOR UPDATE;
  v_from := coalesce(v_from, 'legacy');
  INSERT INTO platform.front_door_flags AS f (host, route, state, table_version, updated_by, updated_at)
    VALUES (p_host, p_route, p_state, p_table_version, p_actor, now())
    ON CONFLICT (host, route) DO UPDATE
      SET state = excluded.state, table_version = excluded.table_version,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  INSERT INTO platform.front_door_flag_changes
    (host, route, from_state, to_state, table_version, actor, reason, stepped_up_at)
    VALUES (p_host, p_route, v_from, p_state, p_table_version, p_actor, p_reason, p_stepped_up_at);
  RETURN v_from;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.set_front_door_flag(text, text, text, integer, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.set_front_door_flag(text, text, text, integer, text, text, timestamptz) TO platform_reader;
--> statement-breakpoint
-- Add a batch of counters (the web flushes its in-memory totals every few seconds):
-- p_stats  [{host, route, servedBy, requests, notFound, proxyErrors, upstream5xx, latencyCount, latencyMsSum, latencyMsMax}]
-- p_paths  [{host, path, servedBy, count}] (the 404 top list)
-- Values are clamped and truncated; increments only.
CREATE FUNCTION platform.record_front_door(p_stats jsonb, p_paths jsonb)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO platform.front_door_stats AS s
    (day, host, route, served_by, requests, not_found, proxy_errors, upstream_5xx, latency_count,
     latency_ms_sum, latency_ms_max)
  SELECT (now() AT TIME ZONE 'UTC')::date, left(x.host, 253), left(x.route, 60), x."servedBy",
         sum(greatest(coalesce(x.requests, 0), 0)), sum(greatest(coalesce(x."notFound", 0), 0)),
         sum(greatest(coalesce(x."proxyErrors", 0), 0)), sum(greatest(coalesce(x."upstream5xx", 0), 0)),
         sum(greatest(coalesce(x."latencyCount", 0), 0)), sum(greatest(coalesce(x."latencyMsSum", 0), 0)),
         max(least(greatest(coalesce(x."latencyMsMax", 0), 0), 2147483647))::integer
  FROM jsonb_to_recordset(coalesce(p_stats, '[]'::jsonb)) AS x(
    host text, route text, "servedBy" text, requests bigint, "notFound" bigint, "proxyErrors" bigint,
    "upstream5xx" bigint, "latencyCount" bigint, "latencyMsSum" bigint, "latencyMsMax" bigint
  )
  WHERE x.host IS NOT NULL AND x.route IS NOT NULL AND x."servedBy" IN ('next', 'legacy')
  GROUP BY 2, 3, 4
  ON CONFLICT (day, host, route, served_by) DO UPDATE SET
    requests = s.requests + excluded.requests,
    not_found = s.not_found + excluded.not_found,
    proxy_errors = s.proxy_errors + excluded.proxy_errors,
    upstream_5xx = s.upstream_5xx + excluded.upstream_5xx,
    latency_count = s.latency_count + excluded.latency_count,
    latency_ms_sum = s.latency_ms_sum + excluded.latency_ms_sum,
    latency_ms_max = greatest(s.latency_ms_max, excluded.latency_ms_max);
  INSERT INTO platform.front_door_not_found AS n (day, host, path, served_by, count)
  SELECT (now() AT TIME ZONE 'UTC')::date, left(x.host, 253), left(x.path, 300), x."servedBy",
         sum(greatest(coalesce(x.count, 0), 0))
  FROM jsonb_to_recordset(coalesce(p_paths, '[]'::jsonb)) AS x(host text, path text, "servedBy" text, count bigint)
  WHERE x.host IS NOT NULL AND x.path IS NOT NULL AND x."servedBy" IN ('next', 'legacy')
  GROUP BY 2, 3, 4
  ON CONFLICT (day, host, path, served_by) DO UPDATE SET count = n.count + excluded.count;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.record_front_door(jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.record_front_door(jsonb, jsonb) TO app_user;
-- hand-written: end
