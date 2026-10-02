CREATE SCHEMA "assistance";
--> statement-breakpoint
CREATE TABLE "assistance"."activity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"actor_user_id" uuid,
	"actor_device_id" uuid,
	"assignee_user_id" uuid,
	"assignee_device_id" uuid,
	CONSTRAINT "activity_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "activity_kind_check" CHECK (kind in ('created', 'assigned', 'started', 'resolved', 'cancelled', 'note')),
	CONSTRAINT "activity_body_check" CHECK (char_length(body) <= 500),
	CONSTRAINT "activity_note_body_check" CHECK (kind <> 'note' or char_length(body) >= 1)
);
--> statement-breakpoint
ALTER TABLE "assistance"."activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistance"."activity" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistance"."requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"priority" text NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"ticket_id" uuid,
	"device_id" uuid,
	"checkpoint_id" uuid,
	"assignee_user_id" uuid,
	"assignee_device_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "requests_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "requests_source_check" CHECK (source in ('guest', 'staff')),
	CONSTRAINT "requests_reason_check" CHECK ((source = 'guest' and reason in ('seat', 'accessibility', 'medical', 'lost_item', 'other')) or (source = 'staff' and reason in ('backup', 'supervisor', 'medical', 'security', 'device'))),
	CONSTRAINT "requests_priority_check" CHECK (priority in ('urgent', 'high', 'normal')),
	CONSTRAINT "requests_state_check" CHECK (state in ('new', 'assigned', 'in_progress', 'resolved', 'cancelled')),
	CONSTRAINT "requests_number_check" CHECK (number >= 1),
	CONSTRAINT "requests_note_check" CHECK (char_length(note) <= 500),
	CONSTRAINT "requests_location_check" CHECK (char_length(location) <= 120),
	CONSTRAINT "requests_origin_check" CHECK ((source = 'guest' and device_id is null) or (source = 'staff' and ticket_id is null)),
	CONSTRAINT "requests_one_assignee_check" CHECK (assignee_user_id is null or assignee_device_id is null)
);
--> statement-breakpoint
ALTER TABLE "assistance"."requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistance"."requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" DROP CONSTRAINT "alerts_rule_check";--> statement-breakpoint
ALTER TABLE "checkin"."staff_alert_pushes" DROP CONSTRAINT "staff_alert_pushes_kind_check";--> statement-breakpoint
ALTER TABLE "assistance"."activity" ADD CONSTRAINT "activity_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "assistance"."requests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_org_id_idx" ON "assistance"."activity" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "activity_org_request_idx" ON "assistance"."activity" USING btree ("org_id","request_id","created_at");--> statement-breakpoint
CREATE INDEX "requests_org_id_idx" ON "assistance"."requests" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_org_event_number_key" ON "assistance"."requests" USING btree ("org_id","event_id","number");--> statement-breakpoint
CREATE INDEX "requests_org_event_state_idx" ON "assistance"."requests" USING btree ("org_id","event_id","state","created_at");--> statement-breakpoint
CREATE INDEX "requests_org_ticket_idx" ON "assistance"."requests" USING btree ("org_id","ticket_id") WHERE ticket_id is not null;--> statement-breakpoint
CREATE INDEX "requests_org_open_due_idx" ON "assistance"."requests" USING btree ("org_id","due_at") WHERE state = 'new';--> statement-breakpoint
-- hand-written: begin
-- A widened CHECK on an existing table: added NOT VALID (no long lock), then validated.
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_check" CHECK (rule in ('unseated', 'undistributed', 'paymentsFailed', 'paymentsStuck', 'refundSurge', 'devicesOffline', 'devicesLowBattery', 'devicesBacklog', 'capacityNear', 'capacityFull', 'sellOut', 'salesPace', 'readiness', 'assistanceOverdue', 'domain', 'payoutsPastDue', 'deliverability', 'automationFailed', 'campaignFailed', 'disputeDeadline')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" VALIDATE CONSTRAINT "alerts_rule_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin
-- A widened CHECK on an existing table: added NOT VALID (no long lock), then validated.
ALTER TABLE "checkin"."staff_alert_pushes" ADD CONSTRAINT "staff_alert_pushes_kind_check" CHECK (kind in ('device_offline', 'device_low_battery', 'device_backlog', 'capacity_near', 'assistance')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."staff_alert_pushes" VALIDATE CONSTRAINT "staff_alert_pushes_kind_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "activity_tenant_isolation" ON "assistance"."activity" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "requests_tenant_isolation" ON "assistance"."requests" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Composite FKs down to lower tiers (other modules' tables). New tables: no NOT VALID needed.
ALTER TABLE "assistance"."requests" ADD CONSTRAINT "requests_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
-- A ticket, device or member that goes away leaves the request (and its history) in place.
ALTER TABLE "assistance"."requests" ADD CONSTRAINT "requests_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE SET NULL ("ticket_id");--> statement-breakpoint
ALTER TABLE "assistance"."requests" ADD CONSTRAINT "requests_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id") ON DELETE SET NULL ("device_id");--> statement-breakpoint
ALTER TABLE "assistance"."requests" ADD CONSTRAINT "requests_assignee_device_fk" FOREIGN KEY ("org_id","assignee_device_id") REFERENCES "checkin"."devices"("org_id","id") ON DELETE SET NULL ("assignee_device_id");--> statement-breakpoint
ALTER TABLE "assistance"."requests" ADD CONSTRAINT "requests_checkpoint_fk" FOREIGN KEY ("org_id","checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id");--> statement-breakpoint
-- Leaving the org unassigns the member's requests.
ALTER TABLE "assistance"."requests" ADD CONSTRAINT "requests_assignee_member_fk" FOREIGN KEY ("org_id","assignee_user_id") REFERENCES "tenancy"."memberships"("org_id","user_id") ON DELETE SET NULL ("assignee_user_id");
-- hand-written: end
