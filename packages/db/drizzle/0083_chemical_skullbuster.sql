CREATE SCHEMA "alerts";
--> statement-breakpoint
CREATE TABLE "alerts"."alert_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alert_id" uuid NOT NULL,
	"action" text NOT NULL,
	"state" text NOT NULL,
	"count" integer NOT NULL,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_history_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "alert_history_action_check" CHECK (action in ('fired', 'updated', 'acknowledged', 'snoozed', 'woke', 'ack_expired', 'resolved', 'reopened', 'notified')),
	CONSTRAINT "alert_history_state_check" CHECK (state in ('open', 'acknowledged', 'snoozed', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "alerts"."alert_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."alert_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alerts"."alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid,
	"rule" text NOT NULL,
	"scope_key" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"count" integer NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"snoozed_until" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"notify_count" integer DEFAULT 0 NOT NULL,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed')),
	CONSTRAINT "alerts_category_check" CHECK (category in ('attendees', 'payments', 'door', 'sales', 'setup', 'messaging')),
	CONSTRAINT "alerts_severity_check" CHECK (severity in ('info', 'warning', 'critical')),
	CONSTRAINT "alerts_state_check" CHECK (state in ('open', 'acknowledged', 'snoozed', 'resolved')),
	CONSTRAINT "alerts_scope_check" CHECK (scope_key = coalesce(event_id::text, 'org')),
	CONSTRAINT "alerts_count_check" CHECK (count >= 0 and notify_count >= 0 and reopen_count >= 0),
	CONSTRAINT "alerts_params_check" CHECK (jsonb_typeof(params) = 'object'),
	CONSTRAINT "alerts_snooze_check" CHECK (state <> 'snoozed' or snoozed_until is not null)
);
--> statement-breakpoint
ALTER TABLE "alerts"."alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alerts"."member_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"sms_phone" text,
	CONSTRAINT "member_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "member_settings_phone_check" CHECK (sms_phone is null or sms_phone ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "alerts"."member_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."member_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alerts"."routing" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text NOT NULL,
	"category" text NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "routing_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "routing_category_check" CHECK (category in ('attendees', 'payments', 'door', 'sales', 'setup', 'messaging')),
	CONSTRAINT "routing_role_check" CHECK (role in ('owner', 'admin', 'manager', 'finance', 'marketing', 'box_office', 'scanner', 'viewer')),
	CONSTRAINT "routing_channels_check" CHECK (channels <@ array['in_app', 'email', 'sms', 'push']::text[])
);
--> statement-breakpoint
ALTER TABLE "alerts"."routing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."routing" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alerts"."sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"tickets" integer NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "sales_targets_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sales_targets_tickets_check" CHECK (tickets between 1 and 10000000)
);
--> statement-breakpoint
ALTER TABLE "alerts"."sales_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."sales_targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."alert_history" ADD CONSTRAINT "alert_history_alert_fk" FOREIGN KEY ("org_id","alert_id") REFERENCES "alerts"."alerts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_history_org_id_idx" ON "alerts"."alert_history" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "alert_history_org_alert_idx" ON "alerts"."alert_history" USING btree ("org_id","alert_id","at");--> statement-breakpoint
CREATE INDEX "alerts_org_id_idx" ON "alerts"."alerts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_org_rule_scope_key" ON "alerts"."alerts" USING btree ("org_id","rule","scope_key");--> statement-breakpoint
CREATE INDEX "alerts_org_state_idx" ON "alerts"."alerts" USING btree ("org_id","state","opened_at");--> statement-breakpoint
CREATE INDEX "alerts_org_event_idx" ON "alerts"."alerts" USING btree ("org_id","event_id") WHERE event_id is not null;--> statement-breakpoint
CREATE INDEX "member_settings_org_id_idx" ON "alerts"."member_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_settings_org_user_key" ON "alerts"."member_settings" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "routing_org_id_idx" ON "alerts"."routing" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_org_role_category_key" ON "alerts"."routing" USING btree ("org_id","role","category");--> statement-breakpoint
CREATE INDEX "sales_targets_org_id_idx" ON "alerts"."sales_targets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_org_event_key" ON "alerts"."sales_targets" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "alert_history_tenant_isolation" ON "alerts"."alert_history" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "alerts_tenant_isolation" ON "alerts"."alerts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "member_settings_tenant_isolation" ON "alerts"."member_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "routing_tenant_isolation" ON "alerts"."routing" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sales_targets_tenant_isolation" ON "alerts"."sales_targets" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M3.2b alert engine)
-- Alerts and sales targets belong to an event of the same org; they go with it.
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "alerts"."sales_targets" ADD CONSTRAINT "sales_targets_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The history is written once and never edited by the app.
REVOKE UPDATE, TRUNCATE ON "alerts"."alert_history" FROM app_user;--> statement-breakpoint
-- The scheduled evaluator (worker, platform_reader): orgs with something to evaluate — an event
-- that is still ahead or running (ending after now − 2 h, starting within 30 days), an alert that
-- is not resolved, or an org-level condition source (a custom domain, a payout account, email
-- sent in the last 7 days, a bulk action in the last day). Org ids only.
CREATE FUNCTION alerts.orgs_to_evaluate(p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT o.org_id FROM (
    SELECT e.org_id FROM events.events e
    WHERE e.status IN ('draft', 'published', 'postponed')
      AND e.ends_at >= now() - interval '2 hours' AND e.starts_at <= now() + interval '30 days'
    UNION ALL SELECT a.org_id FROM alerts.alerts a WHERE a.state <> 'resolved'
    UNION ALL SELECT d.org_id FROM tenancy.org_domains d WHERE NOT d.managed
    UNION ALL SELECT p.org_id FROM payments.payment_accounts p
    UNION ALL SELECT m.org_id FROM notifications.messages m
      WHERE m.channel = 'email' AND m.sent_at >= now() - interval '7 days'
    UNION ALL SELECT b.org_id FROM platform.bulk_operations b WHERE b.updated_at >= now() - interval '1 day'
  ) o
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION alerts.orgs_to_evaluate(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION alerts.orgs_to_evaluate(integer) TO platform_reader;
-- hand-written: end
