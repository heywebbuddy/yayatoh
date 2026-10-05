-- Batch 3l merge: the alert engine's integration and billing rules and signals.
ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_rule_check";--> statement-breakpoint
ALTER TABLE "alerts"."signals" DROP CONSTRAINT "signals_kind_check";--> statement-breakpoint
-- hand-written: begin (CHECKs on existing tables: NOT VALID, then VALIDATE)
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'assistanceOverdue', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed', 'campaignFailed', 'disputeDeadline', 'pledgesUnpaid', 'sessionsNearCapacity', 'sessionWaitlists', 'roomsTooSmall', 'exhibitorsNoLeads', 'exhibitorsNoStaff', 'speakerTasksOverdue', 'deliverablesOverdue', 'printersKiosksOffline', 'approvalBacklog', 'invoicesOverdue', 'rsvpPending', 'guestsUnseated', 'mealsMissing', 'metricRule', 'metricRuleFinance', 'integrationFailed', 'billingPastDue')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."signals" ADD CONSTRAINT "signals_kind_check" CHECK (kind in ('journey_step_failed', 'campaign_send_failed', 'integration_run_failed', 'integration_revoked')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_rule_check";--> statement-breakpoint
ALTER TABLE "alerts"."signals" VALIDATE CONSTRAINT "signals_kind_check";
-- hand-written: end
