CREATE TABLE "analytics"."alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"measure" text NOT NULL,
	"condition" text NOT NULL,
	"threshold" bigint NOT NULL,
	"window_days" integer NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"event_id" uuid,
	"severity" text DEFAULT 'warning' NOT NULL,
	"quiet_hours" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"last_state" text,
	"last_value" bigint,
	"last_evaluated_at" timestamp with time zone,
	CONSTRAINT "alert_rules_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "alert_rules_name_check" CHECK (length(name) between 1 and 80),
	CONSTRAINT "alert_rules_measure_check" CHECK (measure in ('registrations', 'tickets', 'refunded_tickets', 'checkins', 'gross', 'refunds', 'net')),
	CONSTRAINT "alert_rules_condition_check" CHECK (condition in ('above', 'below', 'rise', 'drop')),
	CONSTRAINT "alert_rules_window_check" CHECK (window_days in (1, 7, 14, 30)),
	CONSTRAINT "alert_rules_severity_check" CHECK (severity in ('info', 'warning', 'critical')),
	CONSTRAINT "alert_rules_state_check" CHECK (last_state is null or last_state in ('ok', 'firing')),
	CONSTRAINT "alert_rules_threshold_check" CHECK (threshold between 0 and 1000000000000 and (condition in ('above', 'below') or threshold between 1 and 1000)),
	CONSTRAINT "alert_rules_currency_check" CHECK ((measure in ('gross', 'refunds', 'net')) = (currency ~ '^[A-Z]{3}$') and (currency = '' or currency ~ '^[A-Z]{3}$'))
);
--> statement-breakpoint
ALTER TABLE "analytics"."alert_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."alert_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."attribution_rollups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"day" date NOT NULL,
	"model" text NOT NULL,
	"source" text NOT NULL,
	"medium" text DEFAULT '' NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"link_id" uuid,
	"currency" text NOT NULL,
	"credit_bps" bigint NOT NULL,
	"revenue_minor" bigint NOT NULL,
	CONSTRAINT "attribution_rollups_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "attribution_rollups_org_event_dims_key" UNIQUE NULLS NOT DISTINCT("org_id","event_id","day","model","source","medium","campaign","link_id","currency"),
	CONSTRAINT "attribution_rollups_model_check" CHECK (model in ('first', 'last', 'linear')),
	CONSTRAINT "attribution_rollups_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "attribution_rollups_source_check" CHECK (length(source) between 1 and 255),
	CONSTRAINT "attribution_rollups_dims_check" CHECK (length(medium) <= 100 and length(campaign) <= 102),
	CONSTRAINT "attribution_rollups_values_check" CHECK (credit_bps >= 0 and revenue_minor >= 0)
);
--> statement-breakpoint
ALTER TABLE "analytics"."attribution_rollups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."attribution_rollups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."report_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"finance" boolean NOT NULL,
	"pdf" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	CONSTRAINT "report_files_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "report_files_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "report_files_bytes_check" CHECK (bytes between 1 and 20000000)
);
--> statement-breakpoint
ALTER TABLE "analytics"."report_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."report_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."report_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"recipients_sent" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "report_runs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "report_runs_status_check" CHECK (status in ('pending', 'sent', 'failed')),
	CONSTRAINT "report_runs_period_check" CHECK (period_from <= period_to),
	CONSTRAINT "report_runs_key_check" CHECK (period_key ~ '^(D[0-9]{4}-[0-9]{2}-[0-9]{2}|W[0-9]{4}-[0-9]{2}-[0-9]{2}|M[0-9]{4}-[0-9]{2})$')
);
--> statement-breakpoint
ALTER TABLE "analytics"."report_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."report_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"frequency" text NOT NULL,
	"send_hour" integer DEFAULT 8 NOT NULL,
	"event_id" uuid,
	"recipients" uuid[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"active_since" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "report_schedules_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "report_schedules_name_check" CHECK (length(name) between 1 and 80),
	CONSTRAINT "report_schedules_frequency_check" CHECK (frequency in ('daily', 'weekly', 'monthly')),
	CONSTRAINT "report_schedules_hour_check" CHECK (send_hour between 0 and 23),
	CONSTRAINT "report_schedules_recipients_check" CHECK (cardinality(recipients) between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "analytics"."report_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."report_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics"."saved_views" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"measure" text NOT NULL,
	"dimension" text NOT NULL,
	"model" text,
	"granularity" text DEFAULT 'day' NOT NULL,
	"range" text NOT NULL,
	"from_day" date,
	"to_day" date,
	"event_id" uuid,
	CONSTRAINT "saved_views_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "saved_views_name_check" CHECK (length(name) between 1 and 80),
	CONSTRAINT "saved_views_measure_check" CHECK (measure in ('registrations', 'tickets', 'comp_tickets', 'refunded_tickets', 'checkins', 'no_shows', 'attributed_orders', 'gross', 'refunds', 'net', 'attributed_revenue')),
	CONSTRAINT "saved_views_dimension_check" CHECK (dimension in ('period', 'event', 'channel', 'source', 'campaign')),
	CONSTRAINT "saved_views_model_check" CHECK (model is null or model in ('first', 'last', 'linear')),
	CONSTRAINT "saved_views_granularity_check" CHECK (granularity in ('day', 'week', 'month')),
	CONSTRAINT "saved_views_range_check" CHECK (range in ('7d', '30d', '90d', '365d', 'custom')),
	CONSTRAINT "saved_views_custom_check" CHECK ((range = 'custom') = (from_day is not null and to_day is not null) and (from_day is null or from_day <= to_day))
);
--> statement-breakpoint
ALTER TABLE "analytics"."saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics"."saved_views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketing"."attribution_touches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"link_id" uuid,
	"campaign_id" uuid,
	"source" text NOT NULL,
	"medium" text,
	"campaign" text,
	CONSTRAINT "attribution_touches_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "attribution_touches_kind_check" CHECK (kind in ('click', 'utm', 'referral')),
	CONSTRAINT "attribution_touches_link_check" CHECK ((kind = 'click') = (link_id is not null)),
	CONSTRAINT "attribution_touches_position_check" CHECK (position between 0 and 49),
	CONSTRAINT "attribution_touches_source_check" CHECK (length(source) between 1 and 255),
	CONSTRAINT "attribution_touches_medium_check" CHECK (medium is null or (length(medium) between 1 and 100)),
	CONSTRAINT "attribution_touches_campaign_check" CHECK (campaign is null or (length(campaign) between 1 and 100))
);
--> statement-breakpoint
ALTER TABLE "marketing"."attribution_touches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing"."attribution_touches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_rule_check";--> statement-breakpoint
ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_scope_check";--> statement-breakpoint
ALTER TABLE "alerts"."alerts" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "analytics"."report_files" ADD CONSTRAINT "report_files_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "analytics"."report_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."report_runs" ADD CONSTRAINT "report_runs_schedule_fk" FOREIGN KEY ("org_id","schedule_id") REFERENCES "analytics"."report_schedules"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."attribution_touches" ADD CONSTRAINT "attribution_touches_attribution_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "marketing"."attributions"("org_id","order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."attribution_touches" ADD CONSTRAINT "attribution_touches_link_fk" FOREIGN KEY ("org_id","link_id") REFERENCES "marketing"."tracking_links"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rules_org_id_idx" ON "analytics"."alert_rules" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_org_name_key" ON "analytics"."alert_rules" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "alert_rules_org_enabled_idx" ON "analytics"."alert_rules" USING btree ("org_id","enabled");--> statement-breakpoint
CREATE INDEX "attribution_rollups_org_id_idx" ON "analytics"."attribution_rollups" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "attribution_rollups_org_model_day_idx" ON "analytics"."attribution_rollups" USING btree ("org_id","model","day");--> statement-breakpoint
CREATE INDEX "report_files_org_id_idx" ON "analytics"."report_files" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_files_org_run_variant_key" ON "analytics"."report_files" USING btree ("org_id","run_id","locale","finance");--> statement-breakpoint
CREATE INDEX "report_runs_org_id_idx" ON "analytics"."report_runs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_org_schedule_period_key" ON "analytics"."report_runs" USING btree ("org_id","schedule_id","period_key");--> statement-breakpoint
CREATE INDEX "report_runs_org_created_idx" ON "analytics"."report_runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "report_schedules_org_id_idx" ON "analytics"."report_schedules" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_schedules_org_name_key" ON "analytics"."report_schedules" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "report_schedules_org_enabled_idx" ON "analytics"."report_schedules" USING btree ("org_id","enabled");--> statement-breakpoint
CREATE INDEX "saved_views_org_id_idx" ON "analytics"."saved_views" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_org_user_name_key" ON "analytics"."saved_views" USING btree ("org_id","user_id","name");--> statement-breakpoint
CREATE INDEX "saved_views_org_user_idx" ON "analytics"."saved_views" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "attribution_touches_org_id_idx" ON "marketing"."attribution_touches" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_touches_org_order_position_key" ON "marketing"."attribution_touches" USING btree ("org_id","order_id","position");--> statement-breakpoint
-- hand-written: begin (M6.2b: the CHECKs on the existing alerts table added NOT VALID, then validated;
-- the rule list gains the organizer rules, the scope allows m:{rule id}, the new title column)
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'assistanceOverdue', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed', 'campaignFailed', 'disputeDeadline', 'metricRule', 'metricRuleFinance')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_rule_check";--> statement-breakpoint
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_scope_check" CHECK (scope_key = coalesce(event_id::text, 'org') or (rule in ('metricRule', 'metricRuleFinance') and event_id is null and scope_key ~ '^m:[0-9a-f-]{36}$')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_scope_check";--> statement-breakpoint
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_title_check" CHECK (title is null or length(title) between 1 and 80) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_title_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "alert_rules_tenant_isolation" ON "analytics"."alert_rules" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "attribution_rollups_tenant_isolation" ON "analytics"."attribution_rollups" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "report_files_tenant_isolation" ON "analytics"."report_files" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "report_runs_tenant_isolation" ON "analytics"."report_runs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "report_schedules_tenant_isolation" ON "analytics"."report_schedules" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "saved_views_tenant_isolation" ON "analytics"."saved_views" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "attribution_touches_tenant_isolation" ON "marketing"."attribution_touches" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));;--> statement-breakpoint
-- hand-written: begin (M6.2b cross-module composite FKs: analytics is tier 6, events tier 2)
-- Attribution rollups go with their event (like M6.2a's rollups); a view, rule or schedule
-- filtered on an event that is deleted falls back to all events (only event_id is cleared).
ALTER TABLE "analytics"."attribution_rollups" ADD CONSTRAINT "attribution_rollups_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "analytics"."saved_views" ADD CONSTRAINT "saved_views_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE SET NULL ("event_id");--> statement-breakpoint
ALTER TABLE "analytics"."alert_rules" ADD CONSTRAINT "alert_rules_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE SET NULL ("event_id");--> statement-breakpoint
ALTER TABLE "analytics"."report_schedules" ADD CONSTRAINT "report_schedules_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE SET NULL ("event_id");
-- hand-written: end
