CREATE SCHEMA "automations";
--> statement-breakpoint
CREATE TABLE "automations"."journey_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"journey_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"occurrence_id" uuid,
	"contact_id" uuid NOT NULL,
	"order_id" uuid,
	"trigger" text NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"ended_at" timestamp with time zone,
	CONSTRAINT "journey_runs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "journey_runs_status_check" CHECK (status in ('active', 'completed', 'cancelled')),
	CONSTRAINT "journey_runs_trigger_check" CHECK (trigger in ('order_paid', 'checked_in', 'event_time')),
	CONSTRAINT "journey_runs_ended_check" CHECK ((status = 'active') = (ended_at is null)),
	CONSTRAINT "journey_runs_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automations"."journey_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"journey_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"anchor" text NOT NULL,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"offset_minutes" integer DEFAULT 0 NOT NULL,
	"at_time" text,
	"action" text NOT NULL,
	"subject" text,
	"body" text,
	"label" text,
	"condition" text,
	CONSTRAINT "journey_steps_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "journey_steps_position_check" CHECK (position between 0 and 999),
	CONSTRAINT "journey_steps_anchor_check" CHECK (anchor in ('trigger', 'event_start', 'event_end')),
	CONSTRAINT "journey_steps_action_check" CHECK (action in ('email', 'sms', 'whatsapp', 'push', 'label', 'survey')),
	CONSTRAINT "journey_steps_condition_check" CHECK (condition is null or condition in ('checked_in', 'not_checked_in', 'has_seat', 'no_seat', 'answered_survey', 'not_answered_survey')),
	CONSTRAINT "journey_steps_offset_check" CHECK (offset_days between -365 and 365 and offset_minutes between -10079 and 10079),
	CONSTRAINT "journey_steps_at_time_check" CHECK (at_time is null or at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "journey_steps_copy_check" CHECK ((action not in ('email', 'sms', 'whatsapp', 'push') or (subject is not null and body is not null)) and (action <> 'label' or label is not null)),
	CONSTRAINT "journey_steps_length_check" CHECK (coalesce(length(subject), 0) <= 150 and coalesce(length(body), 0) <= 2000 and coalesce(length(label), 0) <= 100)
);
--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automations"."journeys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"event_id" uuid,
	"series_id" uuid,
	"trigger" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"template" text,
	"enabled_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "journeys_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "journeys_name_check" CHECK (length(btrim(name)) between 1 and 120),
	CONSTRAINT "journeys_scope_check" CHECK ((event_id is null) <> (series_id is null)),
	CONSTRAINT "journeys_trigger_check" CHECK (trigger in ('order_paid', 'checked_in', 'event_time')),
	CONSTRAINT "journeys_template_check" CHECK (template is null or template in ('vision')),
	CONSTRAINT "journeys_enabled_check" CHECK (not enabled or enabled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "automations"."journeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations"."journeys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automations"."scheduled_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"last_error" text,
	"completed_at" timestamp with time zone,
	CONSTRAINT "scheduled_actions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "scheduled_actions_status_check" CHECK (status in ('pending', 'done', 'skipped', 'failed', 'cancelled')),
	CONSTRAINT "scheduled_actions_action_check" CHECK (action in ('email', 'sms', 'whatsapp', 'push', 'label', 'survey')),
	CONSTRAINT "scheduled_actions_attempts_check" CHECK (attempts between 0 and 100),
	CONSTRAINT "scheduled_actions_key_check" CHECK (length(idempotency_key) between 1 and 255),
	CONSTRAINT "scheduled_actions_done_check" CHECK ((status = 'pending') = (completed_at is null)),
	CONSTRAINT "scheduled_actions_outcome_check" CHECK (outcome is null or outcome ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "automations"."scheduled_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations"."scheduled_actions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" ADD CONSTRAINT "journey_runs_journey_fk" FOREIGN KEY ("org_id","journey_id") REFERENCES "automations"."journeys"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations"."journey_steps" ADD CONSTRAINT "journey_steps_journey_fk" FOREIGN KEY ("org_id","journey_id") REFERENCES "automations"."journeys"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations"."scheduled_actions" ADD CONSTRAINT "scheduled_actions_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "automations"."journey_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journey_runs_org_id_idx" ON "automations"."journey_runs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_runs_org_journey_event_contact_key" ON "automations"."journey_runs" USING btree ("org_id","journey_id","event_id","contact_id");--> statement-breakpoint
CREATE INDEX "journey_runs_org_journey_created_idx" ON "automations"."journey_runs" USING btree ("org_id","journey_id","created_at");--> statement-breakpoint
CREATE INDEX "journey_runs_org_event_status_idx" ON "automations"."journey_runs" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "journey_runs_org_contact_idx" ON "automations"."journey_runs" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "journey_runs_org_order_idx" ON "automations"."journey_runs" USING btree ("org_id","order_id") WHERE order_id is not null;--> statement-breakpoint
CREATE INDEX "journey_steps_org_id_idx" ON "automations"."journey_steps" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_steps_org_journey_position_key" ON "automations"."journey_steps" USING btree ("org_id","journey_id","position");--> statement-breakpoint
CREATE INDEX "journeys_org_id_idx" ON "automations"."journeys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "journeys_org_event_idx" ON "automations"."journeys" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "journeys_org_series_idx" ON "automations"."journeys" USING btree ("org_id","series_id");--> statement-breakpoint
CREATE INDEX "journeys_org_updated_idx" ON "automations"."journeys" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "scheduled_actions_org_id_idx" ON "automations"."scheduled_actions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_actions_org_idempotency_key" ON "automations"."scheduled_actions" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "scheduled_actions_org_run_idx" ON "automations"."scheduled_actions" USING btree ("org_id","run_id","position");--> statement-breakpoint
CREATE INDEX "scheduled_actions_org_journey_status_idx" ON "automations"."scheduled_actions" USING btree ("org_id","journey_id","status");--> statement-breakpoint
CREATE INDEX "scheduled_actions_org_due_idx" ON "automations"."scheduled_actions" USING btree ("org_id","due_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "scheduled_actions_due_orgs_idx" ON "automations"."scheduled_actions" USING btree ("due_at","org_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "scheduled_actions_org_event_pending_idx" ON "automations"."scheduled_actions" USING btree ("org_id","event_id") WHERE status in ('pending', 'cancelled');--> statement-breakpoint
CREATE POLICY "journey_runs_tenant_isolation" ON "automations"."journey_runs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "journey_steps_tenant_isolation" ON "automations"."journey_steps" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "journeys_tenant_isolation" ON "automations"."journeys" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "scheduled_actions_tenant_isolation" ON "automations"."scheduled_actions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M3.7a journeys: cross-module composite FKs, the worker's org finder)
-- A journey belongs to an event or a series of the same org; runs to an event of the same org
-- (down the tiers). Fresh tables: no NOT VALID needed.
ALTER TABLE "automations"."journeys" ADD CONSTRAINT "journeys_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "automations"."journeys" ADD CONSTRAINT "journeys_series_fk" FOREIGN KEY ("org_id","series_id") REFERENCES "events"."series"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "automations"."journey_runs" ADD CONSTRAINT "journey_runs_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
-- The runner (worker, platform_reader): orgs with journey steps due now, or with switched-on
-- journeys that enroll people at a time relative to the event. Ids only.
CREATE FUNCTION automations.orgs_with_journey_work(p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT w.org_id FROM (
    SELECT a.org_id FROM automations.scheduled_actions a WHERE a.status = 'pending' AND a.due_at <= now()
    UNION
    SELECT j.org_id FROM automations.journeys j WHERE j.enabled AND j.trigger = 'event_time'
  ) w
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION automations.orgs_with_journey_work(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION automations.orgs_with_journey_work(integer) TO platform_reader;
-- hand-written: end
