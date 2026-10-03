ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_rule_check";--> statement-breakpoint
-- hand-written: begin
-- M4.6a: the widened rule CHECK on an existing table, added NOT VALID (no long lock), then validated.
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'assistanceOverdue', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed', 'campaignFailed', 'disputeDeadline', 'rsvpPending', 'guestsUnseated', 'mealsMissing')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_rule_check";
-- hand-written: end
