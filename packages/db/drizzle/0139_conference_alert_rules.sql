ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_rule_check";--> statement-breakpoint
ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_category_check";--> statement-breakpoint
ALTER TABLE "alerts"."routing" DROP CONSTRAINT "routing_category_check";--> statement-breakpoint
-- hand-written: begin (M5.9a: three CHECKs widened on existing tables with the conference rules and group; added NOT VALID, then validated)
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'assistanceOverdue', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed', 'campaignFailed', 'disputeDeadline', 'pledgesUnpaid', 'sessionsNearCapacity', 'sessionWaitlists', 'roomsTooSmall', 'exhibitorsNoLeads', 'exhibitorsNoStaff', 'speakerTasksOverdue', 'deliverablesOverdue', 'printersKiosksOffline', 'approvalBacklog', 'invoicesOverdue')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_category_check" CHECK (category in ('attendees', 'payments', 'door', 'sales', 'setup', 'messaging', 'conference')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."routing" ADD CONSTRAINT "routing_category_check" CHECK (category in ('attendees', 'payments', 'door', 'sales', 'setup', 'messaging', 'conference')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_rule_check";--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_category_check";--> statement-breakpoint
ALTER TABLE "alerts"."routing" VALIDATE CONSTRAINT "routing_category_check";
-- hand-written: end
