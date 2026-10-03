CREATE SCHEMA "integrations";
--> statement-breakpoint
CREATE TABLE "integrations"."connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connector" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"auth_connection_id" text,
	"account_label" text,
	"state_hash" text,
	"state_expires_at" timestamp with time zone,
	"connected_by" uuid,
	"connected_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"sync_interval_minutes" integer DEFAULT 60 NOT NULL,
	"next_sync_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "connections_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "connections_connector_check" CHECK (connector ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "connections_status_check" CHECK (status in ('pending', 'active', 'paused', 'revoked', 'failed')),
	CONSTRAINT "connections_revoke_reason_check" CHECK (revoke_reason is null or revoke_reason in ('user', 'provider')),
	CONSTRAINT "connections_revoked_check" CHECK ((status = 'revoked') = (revoked_at is not null)),
	CONSTRAINT "connections_paused_check" CHECK ((status = 'paused') = (paused_at is not null)),
	CONSTRAINT "connections_auth_check" CHECK (status in ('pending', 'failed') or (auth_connection_id is not null and connected_at is not null)),
	CONSTRAINT "connections_state_check" CHECK (state_hash is null or status = 'pending'),
	CONSTRAINT "connections_auth_id_check" CHECK (auth_connection_id is null or length(auth_connection_id) between 1 and 255),
	CONSTRAINT "connections_label_check" CHECK (account_label is null or length(account_label) <= 120),
	CONSTRAINT "connections_interval_check" CHECK (sync_interval_minutes between 5 and 10080),
	CONSTRAINT "connections_failures_check" CHECK (consecutive_failures between 0 and 1000),
	CONSTRAINT "connections_last_status_check" CHECK (last_sync_status is null or last_sync_status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "integrations"."connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."field_mappings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"direction" text NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"created_by" uuid,
	CONSTRAINT "field_mappings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "field_mappings_object_check" CHECK (object_type ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "field_mappings_direction_check" CHECK (direction in ('pull', 'push')),
	CONSTRAINT "field_mappings_version_check" CHECK (version between 1 and 100000),
	CONSTRAINT "field_mappings_rules_check" CHECK (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 50)
);
--> statement-breakpoint
ALTER TABLE "integrations"."field_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."field_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."record_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"external_id" text NOT NULL,
	"local_id" uuid NOT NULL,
	"remote_version" text,
	"local_hash" text,
	"last_direction" text NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "record_links_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "record_links_direction_check" CHECK (last_direction in ('pull', 'push')),
	CONSTRAINT "record_links_external_check" CHECK (length(external_id) between 1 and 255),
	CONSTRAINT "record_links_version_check" CHECK (remote_version is null or length(remote_version) <= 255),
	CONSTRAINT "record_links_hash_check" CHECK (local_hash is null or local_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "integrations"."record_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."record_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"direction" text NOT NULL,
	"cursor" text,
	CONSTRAINT "sync_cursors_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sync_cursors_direction_check" CHECK (direction in ('pull', 'push')),
	CONSTRAINT "sync_cursors_cursor_check" CHECK (cursor is null or length(cursor) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "integrations"."sync_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."sync_cursors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."sync_errors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"run_id" uuid,
	"step" text NOT NULL,
	"object_type" text,
	"direction" text,
	"external_id" text,
	"local_id" uuid,
	"record_key" text NOT NULL,
	"code" text NOT NULL,
	"field" text,
	"status" text DEFAULT 'open' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "sync_errors_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sync_errors_step_check" CHECK (step in ('auth', 'pull', 'map', 'write', 'push')),
	CONSTRAINT "sync_errors_status_check" CHECK (status in ('open', 'resolved', 'dismissed')),
	CONSTRAINT "sync_errors_direction_check" CHECK (direction is null or direction in ('pull', 'push')),
	CONSTRAINT "sync_errors_code_check" CHECK (code ~ '^[a-z0-9_]{1,60}$'),
	CONSTRAINT "sync_errors_field_check" CHECK (field is null or field ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "sync_errors_record_key_check" CHECK (length(record_key) between 1 and 320),
	CONSTRAINT "sync_errors_external_check" CHECK (external_id is null or length(external_id) between 1 and 255),
	CONSTRAINT "sync_errors_counts_check" CHECK (attempts between 0 and 1000 and occurrences between 1 and 1000000),
	CONSTRAINT "sync_errors_resolved_check" CHECK ((status = 'open') = (resolved_at is null))
);
--> statement-breakpoint
ALTER TABLE "integrations"."sync_errors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."sync_errors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"pulled" integer DEFAULT 0 NOT NULL,
	"pushed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	CONSTRAINT "sync_runs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sync_runs_trigger_check" CHECK (trigger in ('manual', 'schedule', 'retry')),
	CONSTRAINT "sync_runs_status_check" CHECK (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
	CONSTRAINT "sync_runs_counts_check" CHECK (pulled >= 0 and pushed >= 0 and skipped >= 0 and failed >= 0),
	CONSTRAINT "sync_runs_finished_check" CHECK ((status in ('queued', 'running')) = (finished_at is null)),
	CONSTRAINT "sync_runs_error_code_check" CHECK (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$')
);
--> statement-breakpoint
ALTER TABLE "integrations"."sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."sync_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."field_mappings" ADD CONSTRAINT "field_mappings_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."record_links" ADD CONSTRAINT "record_links_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."sync_cursors" ADD CONSTRAINT "sync_cursors_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."sync_errors" ADD CONSTRAINT "sync_errors_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."sync_runs" ADD CONSTRAINT "sync_runs_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_org_id_idx" ON "integrations"."connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_org_connector_live_key" ON "integrations"."connections" USING btree ("org_id","connector") WHERE status in ('pending', 'active', 'paused');--> statement-breakpoint
CREATE INDEX "connections_org_created_idx" ON "integrations"."connections" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "connections_next_sync_idx" ON "integrations"."connections" USING btree ("next_sync_at","org_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "field_mappings_org_id_idx" ON "integrations"."field_mappings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_mappings_org_connection_object_version_key" ON "integrations"."field_mappings" USING btree ("org_id","connection_id","object_type","direction","version");--> statement-breakpoint
CREATE INDEX "record_links_org_id_idx" ON "integrations"."record_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_org_connection_external_key" ON "integrations"."record_links" USING btree ("org_id","connection_id","object_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_org_connection_local_key" ON "integrations"."record_links" USING btree ("org_id","connection_id","object_type","local_id");--> statement-breakpoint
CREATE INDEX "sync_cursors_org_id_idx" ON "integrations"."sync_cursors" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_org_connection_object_key" ON "integrations"."sync_cursors" USING btree ("org_id","connection_id","object_type","direction");--> statement-breakpoint
CREATE INDEX "sync_errors_org_id_idx" ON "integrations"."sync_errors" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_errors_org_open_record_key" ON "integrations"."sync_errors" USING btree ("org_id","connection_id","step","record_key") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "sync_errors_org_status_seen_idx" ON "integrations"."sync_errors" USING btree ("org_id","status","last_seen_at");--> statement-breakpoint
CREATE INDEX "sync_errors_org_connection_status_idx" ON "integrations"."sync_errors" USING btree ("org_id","connection_id","status");--> statement-breakpoint
CREATE INDEX "sync_runs_org_id_idx" ON "integrations"."sync_runs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_org_connection_active_key" ON "integrations"."sync_runs" USING btree ("org_id","connection_id") WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "sync_runs_org_connection_created_idx" ON "integrations"."sync_runs" USING btree ("org_id","connection_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_runs_queued_idx" ON "integrations"."sync_runs" USING btree ("created_at","org_id") WHERE status = 'queued';--> statement-breakpoint
CREATE POLICY "connections_tenant_isolation" ON "integrations"."connections" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "field_mappings_tenant_isolation" ON "integrations"."field_mappings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "record_links_tenant_isolation" ON "integrations"."record_links" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sync_cursors_tenant_isolation" ON "integrations"."sync_cursors" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sync_errors_tenant_isolation" ON "integrations"."sync_errors" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sync_runs_tenant_isolation" ON "integrations"."sync_runs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin (M6.4a integrations framework)
-- P6-13: every plan gets the `integrations` module key (free within quotas in beta); the
-- connectors are still behind the `IntegrationAuth` port (fake in dev/CI, off in production
-- until Nango is configured). Batch 3i merge: M6.6a's placeholder tiers (`tier_*`, switched off)
-- keep their own module sets (integrations from Pro up), so they are left out here.
INSERT INTO billing.plan_modules (plan_key, module_key)
SELECT key, 'integrations' FROM billing.plans WHERE key NOT LIKE 'tier\_%'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The sync scheduler (worker leader, platform_reader): connections with work now — a queued run
-- (asked for by a person: first), a scheduled sync that is due, or a failed record whose retry is
-- due. Ids only.
CREATE FUNCTION integrations.connections_with_sync_work(p_limit integer)
RETURNS TABLE (org_id uuid, connection_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT w.org_id, w.id FROM (
    SELECT c.org_id, c.id, c.next_sync_at,
      EXISTS (SELECT 1 FROM integrations.sync_runs r
              WHERE r.org_id = c.org_id AND r.connection_id = c.id AND r.status = 'queued') AS queued
    FROM integrations.connections c
    WHERE c.status = 'active'
  ) w
  WHERE w.queued
    OR w.next_sync_at <= now()
    OR EXISTS (SELECT 1 FROM integrations.sync_errors e
               WHERE e.org_id = w.org_id AND e.connection_id = w.id AND e.status = 'open'
                 AND e.next_retry_at <= now())
  ORDER BY w.queued DESC, w.next_sync_at NULLS FIRST
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION integrations.connections_with_sync_work(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integrations.connections_with_sync_work(integer) TO platform_reader;
-- hand-written: end
