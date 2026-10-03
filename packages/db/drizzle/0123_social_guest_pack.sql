-- Renumbered on agent/u4 (merge of agent/m4.6a onto merge/next-3i): 0113_yielding_wind_dancer (M4.3a),
-- 0114_thankful_skaar (M4.4a), 0115_special_enchantress (M4.4b) and 0116_keen_sally_floyd (M4.6a), verbatim in order.
CREATE TABLE "seating"."guest_seats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sub_event_id" uuid,
	"guest_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "guest_seats_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "seating"."guest_seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."guest_seats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seating"."vip_tables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "vip_tables_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "seating"."vip_tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."vip_tables" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "guest_seats_org_id_idx" ON "seating"."guest_seats" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_seats_org_event_plan_guest_key" ON "seating"."guest_seats" USING btree ("org_id","event_id","guest_id") WHERE sub_event_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_seats_org_sub_event_guest_key" ON "seating"."guest_seats" USING btree ("org_id","sub_event_id","guest_id") WHERE sub_event_id is not null;--> statement-breakpoint
CREATE INDEX "guest_seats_org_event_item_idx" ON "seating"."guest_seats" USING btree ("org_id","event_id","sub_event_id","item_id");--> statement-breakpoint
CREATE INDEX "guest_seats_org_guest_idx" ON "seating"."guest_seats" USING btree ("org_id","guest_id");--> statement-breakpoint
CREATE INDEX "vip_tables_org_id_idx" ON "seating"."vip_tables" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vip_tables_org_event_item_key" ON "seating"."vip_tables" USING btree ("org_id","event_id","item_id");--> statement-breakpoint
CREATE POLICY "guest_seats_tenant_isolation" ON "seating"."guest_seats" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "vip_tables_tenant_isolation" ON "seating"."vip_tables" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.3a: a guest's place belongs to one event of the org, to a guest of the guests module and,
-- for a sub-event's chart, to a sub-event of that same event (guests is the same tier: a
-- reference only, never an import). Removing the event, the guest or the sub-event removes the
-- places with it. New tables only (migrate.ts sets lock_timeout).
ALTER TABLE "seating"."guest_seats" ADD CONSTRAINT "guest_seats_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."guest_seats" ADD CONSTRAINT "guest_seats_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."guest_seats" ADD CONSTRAINT "guest_seats_sub_event_fk" FOREIGN KEY ("org_id","event_id","sub_event_id") REFERENCES "guests"."sub_events"("org_id","event_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seating"."vip_tables" ADD CONSTRAINT "vip_tables_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
--> statement-breakpoint
-- hand-written: begin
-- M4.4a: the seat finder's `pin` mode. Widened check (add v2 NOT VALID → validate → drop → rename),
-- so the table is never without one. migrate.ts sets lock_timeout.
ALTER TABLE "seating"."event_layouts" ADD CONSTRAINT "event_layouts_finder_mode_check_v2" CHECK (finder_mode in ('code', 'name', 'pin')) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" VALIDATE CONSTRAINT "event_layouts_finder_mode_check_v2";--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" DROP CONSTRAINT "event_layouts_finder_mode_check";--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" RENAME CONSTRAINT "event_layouts_finder_mode_check_v2" TO "event_layouts_finder_mode_check";
-- hand-written: end
--> statement-breakpoint
CREATE TABLE "checkin"."guest_arrivals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"device_id" uuid,
	"recorded_by" uuid,
	"client_id" uuid NOT NULL,
	CONSTRAINT "guest_arrivals_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "guest_arrivals_source_check" CHECK (source in ('scanner', 'kiosk', 'host')),
	CONSTRAINT "guest_arrivals_device_check" CHECK (source <> 'host' or device_id is null)
);
--> statement-breakpoint
ALTER TABLE "checkin"."guest_arrivals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."guest_arrivals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "kiosk_kind" text;--> statement-breakpoint
CREATE INDEX "guest_arrivals_org_id_idx" ON "checkin"."guest_arrivals" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_arrivals_org_guest_key" ON "checkin"."guest_arrivals" USING btree ("org_id","guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_arrivals_org_client_key" ON "checkin"."guest_arrivals" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "guest_arrivals_org_event_at_idx" ON "checkin"."guest_arrivals" USING btree ("org_id","event_id","arrived_at");--> statement-breakpoint
-- hand-written: begin
-- M4.4b: the new CHECK on an existing table is added NOT VALID, then validated (no long lock).
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_kiosk_kind_check" CHECK (kiosk_kind is null or kiosk_kind in ('tickets', 'guests', 'board')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_kiosk_kind_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "guest_arrivals_tenant_isolation" ON "checkin"."guest_arrivals" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.4b: an arrival belongs to an event of the org and to a guest of the guests module (a lower
-- tier: a reference only); removing either removes the arrival. A device that goes keeps the
-- arrival (device_id cleared). New table only (migrate.ts sets lock_timeout).
ALTER TABLE "checkin"."guest_arrivals" ADD CONSTRAINT "guest_arrivals_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "checkin"."guest_arrivals" ADD CONSTRAINT "guest_arrivals_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "checkin"."guest_arrivals" ADD CONSTRAINT "guest_arrivals_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id") ON DELETE SET NULL ("device_id");
-- hand-written: end
--> statement-breakpoint
ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_rule_check";--> statement-breakpoint
-- hand-written: begin
-- M4.6a: the widened rule CHECK on an existing table, added NOT VALID (no long lock), then validated.
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'assistanceOverdue', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed', 'campaignFailed', 'disputeDeadline', 'rsvpPending', 'guestsUnseated', 'mealsMissing')) NOT VALID;--> statement-breakpoint
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
