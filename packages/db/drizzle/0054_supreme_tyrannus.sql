CREATE SCHEMA "reports";
--> statement-breakpoint
CREATE TABLE "reports"."analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"event_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_event_id" uuid NOT NULL,
	"replayed" boolean DEFAULT false NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "analytics_events_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "reports"."analytics_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports"."analytics_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports"."metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid,
	"key" text NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"shard" smallint DEFAULT 0 NOT NULL,
	"value" bigint NOT NULL,
	"source_at" timestamp with time zone,
	"projected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "metric_snapshots_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "metric_snapshots_org_event_key_currency_shard_key" UNIQUE NULLS NOT DISTINCT("org_id","event_id","key","currency","shard"),
	CONSTRAINT "metric_snapshots_shard_check" CHECK (shard between 0 and 63)
);
--> statement-breakpoint
ALTER TABLE "reports"."metric_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports"."metric_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports"."metric_timeseries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"bucket" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"shard" smallint DEFAULT 0 NOT NULL,
	"value" bigint NOT NULL,
	"projected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "metric_timeseries_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "metric_timeseries_bucket_check" CHECK (bucket in ('minute', 'hour')),
	CONSTRAINT "metric_timeseries_shard_check" CHECK (shard between 0 and 63)
);
--> statement-breakpoint
ALTER TABLE "reports"."metric_timeseries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports"."metric_timeseries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports"."projector_lag" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumer" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL,
	"lag_ms" integer NOT NULL,
	CONSTRAINT "projector_lag_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "projector_lag_lag_check" CHECK (lag_ms >= 0)
);
--> statement-breakpoint
ALTER TABLE "reports"."projector_lag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports"."projector_lag" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."domain_events" ADD COLUMN "replayed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "analytics_events_org_id_idx" ON "reports"."analytics_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_events_org_source_name_key" ON "reports"."analytics_events" USING btree ("org_id","source_event_id","name");--> statement-breakpoint
CREATE INDEX "analytics_events_org_name_occurred_idx" ON "reports"."analytics_events" USING btree ("org_id","name","occurred_at");--> statement-breakpoint
CREATE INDEX "metric_snapshots_org_id_idx" ON "reports"."metric_snapshots" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "metric_timeseries_org_id_idx" ON "reports"."metric_timeseries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_timeseries_point_key" ON "reports"."metric_timeseries" USING btree ("org_id","event_id","key","bucket","bucket_start","currency","shard");--> statement-breakpoint
CREATE INDEX "projector_lag_org_id_idx" ON "reports"."projector_lag" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "projector_lag_org_consumer_projected_idx" ON "reports"."projector_lag" USING btree ("org_id","consumer","projected_at");--> statement-breakpoint
CREATE POLICY "analytics_events_tenant_isolation" ON "reports"."analytics_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "metric_snapshots_tenant_isolation" ON "reports"."metric_snapshots" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "metric_timeseries_tenant_isolation" ON "reports"."metric_timeseries" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "projector_lag_tenant_isolation" ON "reports"."projector_lag" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M3.1a: metric projections belong to one event of the org (composite FKs; a deleted event takes its projections).
ALTER TABLE "reports"."metric_snapshots" ADD CONSTRAINT "metric_snapshots_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "reports"."metric_timeseries" ADD CONSTRAINT "metric_timeseries_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The analytics sink is append-only for the runtime role (retention drops partitions as the migrator).
REVOKE UPDATE, DELETE, TRUNCATE ON "reports"."analytics_events" FROM app_user;--> statement-breakpoint
-- Lag samples are never rewritten; the retention pass deletes samples older than 7 days.
REVOKE UPDATE, TRUNCATE ON "reports"."projector_lag" FROM app_user;
-- hand-written: end
