CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE TABLE "analytics"."backfill_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"adapter" text NOT NULL,
	"cursor" uuid,
	"page_size" integer NOT NULL,
	"pages_per_minute" integer NOT NULL,
	"pages_done" integer DEFAULT 0 NOT NULL,
	"events_done" integer DEFAULT 0 NOT NULL,
	"events_written" integer DEFAULT 0 NOT NULL,
	"next_page_at" timestamp with time zone NOT NULL,
	"started_by" text NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "backfill_runs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "backfill_runs_status_check" CHECK (status in ('running', 'done', 'failed', 'cancelled')),
	CONSTRAINT "backfill_runs_adapter_check" CHECK (adapter in ('postgres', 'tinybird')),
	CONSTRAINT "backfill_runs_page_check" CHECK (page_size between 1 and 500 and pages_per_minute between 1 and 600)
);
--> statement-breakpoint
ALTER TABLE "analytics"."backfill_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."backfill_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."daily_rollups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "daily_rollups_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "daily_rollups_metric_check" CHECK (metric in ('orders', 'tickets', 'comp_tickets', 'refunded_tickets', 'checkins', 'gross', 'refunds')),
	CONSTRAINT "daily_rollups_currency_check" CHECK (currency = '' or currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "analytics"."daily_rollups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."daily_rollups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."event_rollups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"end_day" date NOT NULL,
	"valid_tickets" integer NOT NULL,
	"checked_in" integer NOT NULL,
	CONSTRAINT "event_rollups_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_rollups_counts_check" CHECK (valid_tickets >= 0 and checked_in >= 0)
);
--> statement-breakpoint
ALTER TABLE "analytics"."event_rollups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."event_rollups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."event_sync" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"adapter" text NOT NULL,
	"hash" text NOT NULL,
	"version" bigint NOT NULL,
	"time_zone" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_sync_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_sync_adapter_check" CHECK (adapter in ('postgres', 'tinybird'))
);
--> statement-breakpoint
ALTER TABLE "analytics"."event_sync" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."event_sync" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."ingest_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"event_id" uuid,
	"adapter" text NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "ingest_log_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "ingest_log_outcome_check" CHECK (outcome in ('written', 'unchanged', 'skipped')),
	CONSTRAINT "ingest_log_adapter_check" CHECK (adapter in ('postgres', 'tinybird'))
);
--> statement-breakpoint
ALTER TABLE "analytics"."ingest_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."ingest_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "backfill_runs_org_id_idx" ON "analytics"."backfill_runs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "backfill_runs_org_running_key" ON "analytics"."backfill_runs" USING btree ("org_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "backfill_runs_org_created_idx" ON "analytics"."backfill_runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "daily_rollups_org_id_idx" ON "analytics"."daily_rollups" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_rollups_org_event_day_metric_currency_key" ON "analytics"."daily_rollups" USING btree ("org_id","event_id","day","metric","currency");--> statement-breakpoint
CREATE INDEX "daily_rollups_org_day_idx" ON "analytics"."daily_rollups" USING btree ("org_id","day","metric");--> statement-breakpoint
CREATE INDEX "event_rollups_org_id_idx" ON "analytics"."event_rollups" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_rollups_org_event_key" ON "analytics"."event_rollups" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "event_rollups_org_end_day_idx" ON "analytics"."event_rollups" USING btree ("org_id","end_day");--> statement-breakpoint
CREATE INDEX "event_sync_org_id_idx" ON "analytics"."event_sync" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_sync_org_adapter_event_key" ON "analytics"."event_sync" USING btree ("org_id","adapter","event_id");--> statement-breakpoint
CREATE INDEX "ingest_log_org_id_idx" ON "analytics"."ingest_log" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_log_org_source_event_key" ON "analytics"."ingest_log" USING btree ("org_id","source_event_id");--> statement-breakpoint
CREATE INDEX "ingest_log_org_created_idx" ON "analytics"."ingest_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "backfill_runs_tenant_isolation" ON "analytics"."backfill_runs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "daily_rollups_tenant_isolation" ON "analytics"."daily_rollups" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_rollups_tenant_isolation" ON "analytics"."event_rollups" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_sync_tenant_isolation" ON "analytics"."event_sync" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "ingest_log_tenant_isolation" ON "analytics"."ingest_log" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M6.2a: warehouse rows belong to one event of the org (composite FKs; a deleted event takes its rows).
ALTER TABLE "analytics"."daily_rollups" ADD CONSTRAINT "daily_rollups_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "analytics"."event_rollups" ADD CONSTRAINT "event_rollups_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "analytics"."event_sync" ADD CONSTRAINT "event_sync_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The ingest log is append-only for the runtime role (one row per source event id).
REVOKE UPDATE, DELETE, TRUNCATE ON "analytics"."ingest_log" FROM app_user;--> statement-breakpoint
-- P6-13: the `analytics_pro` entitlement key, free in beta on the default plan.
INSERT INTO billing.plan_modules (plan_key, module_key) VALUES ('launch_standard', 'analytics_pro') ON CONFLICT DO NOTHING;
-- hand-written: end
