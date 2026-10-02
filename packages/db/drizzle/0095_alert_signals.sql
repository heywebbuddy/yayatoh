CREATE TABLE "alerts"."signals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "signals_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "signals_kind_check" CHECK (kind in ('journey_step_failed', 'campaign_send_failed'))
);
--> statement-breakpoint
ALTER TABLE "alerts"."signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."signals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "signals_org_id_idx" ON "alerts"."signals" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_org_source_event_key" ON "alerts"."signals" USING btree ("org_id","source_event_id");--> statement-breakpoint
CREATE INDEX "signals_org_kind_occurred_idx" ON "alerts"."signals" USING btree ("org_id","kind","occurred_at");--> statement-breakpoint
CREATE POLICY "signals_tenant_isolation" ON "alerts"."signals" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (batch 3e merge: alerts_rule_check widened with campaignFailed and disputeDeadline on the existing table, NOT VALID then validated)
ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_rule_check";--> statement-breakpoint
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed', 'campaignFailed', 'disputeDeadline')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_rule_check";
-- hand-written: end
