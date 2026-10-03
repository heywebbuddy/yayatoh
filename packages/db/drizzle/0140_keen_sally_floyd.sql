ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_rule_check";--> statement-breakpoint
-- hand-written: begin
-- M4.6a: the widened rule CHECK on an existing table, added NOT VALID (no long lock), then validated.
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'assistanceOverdue', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed', 'campaignFailed', 'disputeDeadline', 'pledgesUnpaid', 'sessionsNearCapacity', 'sessionWaitlists', 'roomsTooSmall', 'exhibitorsNoLeads', 'exhibitorsNoStaff', 'speakerTasksOverdue', 'deliverablesOverdue', 'printersKiosksOffline', 'approvalBacklog', 'invoicesOverdue', 'rsvpPending', 'guestsUnseated', 'mealsMissing')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_rule_check";
-- hand-written: end
--> statement-breakpoint
-- hand-written: begin
-- M4.6a: the sweep's org finder also returns orgs with an RSVP deadline in the last 120 days or
-- the next 8 (the RSVP rule fires from deadline −7 d, for events further out than 30 days too).
-- Same signature, owner and grants; ids only.
CREATE OR REPLACE FUNCTION alerts.orgs_to_evaluate(p_limit integer)
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
    UNION ALL SELECT s.org_id FROM guests.rsvp_settings s
      WHERE s.deadline BETWEEN now() - interval '120 days' AND now() + interval '8 days'
  ) o
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION alerts.orgs_to_evaluate(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION alerts.orgs_to_evaluate(integer) TO platform_reader;
-- hand-written: end
