CREATE TABLE "orders"."mass_refund_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"refund_id" uuid,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"code" text,
	CONSTRAINT "mass_refund_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "mass_refund_items_status_check" CHECK (status in ('pending', 'refunded', 'skipped_disputed', 'skipped', 'failed')),
	CONSTRAINT "mass_refund_items_amount_check" CHECK (amount_minor >= 0),
	CONSTRAINT "mass_refund_items_code_check" CHECK (code is null or code ~ '^[a-z_]{1,60}$')
);
--> statement-breakpoint
ALTER TABLE "orders"."mass_refund_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."mass_refund_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."mass_refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"currency" text NOT NULL,
	"total" integer NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"refunded" integer DEFAULT 0 NOT NULL,
	"skipped_disputed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"requested_by" text NOT NULL,
	"paused_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"reconciled" boolean,
	"ledger_cash_minor" bigint,
	"expected_cash_minor" bigint,
	"receivable_minor" bigint,
	CONSTRAINT "mass_refunds_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "mass_refunds_status_check" CHECK (status in ('running', 'paused', 'done')),
	CONSTRAINT "mass_refunds_reason_check" CHECK (reason in ('event_cancelled', 'event_postponed')),
	CONSTRAINT "mass_refunds_counts_check" CHECK (total >= 0 and processed between 0 and total and refunded + skipped_disputed + skipped + failed = processed and refunded_minor >= 0),
	CONSTRAINT "mass_refunds_done_check" CHECK ((status = 'done') = (finished_at is not null))
);
--> statement-breakpoint
ALTER TABLE "orders"."mass_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."mass_refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."order_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	CONSTRAINT "order_notes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "order_notes_body_check" CHECK (length(body) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "orders"."order_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."order_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ticket_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"message" text,
	"due_at" timestamp with time zone NOT NULL,
	"decline_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"refund_id" uuid,
	CONSTRAINT "refund_requests_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "refund_requests_status_check" CHECK (status in ('open', 'approved', 'declined')),
	CONSTRAINT "refund_requests_message_check" CHECK (message is null or length(message) between 1 and 1000),
	CONSTRAINT "refund_requests_decline_check" CHECK ((status = 'declined') = (decline_reason is not null) and (decline_reason is null or length(decline_reason) between 3 and 500)),
	CONSTRAINT "refund_requests_decided_check" CHECK ((status = 'open') = (decided_at is null)),
	CONSTRAINT "refund_requests_refund_check" CHECK (status = 'approved' or refund_id is null)
);
--> statement-breakpoint
ALTER TABLE "orders"."refund_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."refund_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "refund_policy_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "orders"."mass_refund_items" ADD CONSTRAINT "mass_refund_items_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "orders"."mass_refunds"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."mass_refund_items" ADD CONSTRAINT "mass_refund_items_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."mass_refund_items" ADD CONSTRAINT "mass_refund_items_refund_fk" FOREIGN KEY ("org_id","refund_id") REFERENCES "orders"."refunds"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_notes" ADD CONSTRAINT "order_notes_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."refund_requests" ADD CONSTRAINT "refund_requests_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."refund_requests" ADD CONSTRAINT "refund_requests_refund_fk" FOREIGN KEY ("org_id","refund_id") REFERENCES "orders"."refunds"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mass_refund_items_org_id_idx" ON "orders"."mass_refund_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mass_refund_items_org_run_order_key" ON "orders"."mass_refund_items" USING btree ("org_id","run_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mass_refund_items_org_run_position_key" ON "orders"."mass_refund_items" USING btree ("org_id","run_id","position");--> statement-breakpoint
CREATE INDEX "mass_refund_items_org_run_status_idx" ON "orders"."mass_refund_items" USING btree ("org_id","run_id","status","position");--> statement-breakpoint
CREATE INDEX "mass_refund_items_org_order_idx" ON "orders"."mass_refund_items" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "mass_refunds_org_id_idx" ON "orders"."mass_refunds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "mass_refunds_org_event_idx" ON "orders"."mass_refunds" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "mass_refunds_org_status_idx" ON "orders"."mass_refunds" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mass_refunds_org_event_live_key" ON "orders"."mass_refunds" USING btree ("org_id","event_id") WHERE status in ('running', 'paused');--> statement-breakpoint
CREATE INDEX "order_notes_org_id_idx" ON "orders"."order_notes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "order_notes_org_order_idx" ON "orders"."order_notes" USING btree ("org_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "refund_requests_org_id_idx" ON "orders"."refund_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "refund_requests_org_status_due_idx" ON "orders"."refund_requests" USING btree ("org_id","status","due_at");--> statement-breakpoint
CREATE INDEX "refund_requests_org_order_idx" ON "orders"."refund_requests" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "refund_requests_org_event_idx" ON "orders"."refund_requests" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_requests_org_order_open_key" ON "orders"."refund_requests" USING btree ("org_id","order_id") WHERE status = 'open';--> statement-breakpoint
CREATE POLICY "mass_refund_items_tenant_isolation" ON "orders"."mass_refund_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "mass_refunds_tenant_isolation" ON "orders"."mass_refunds" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "order_notes_tenant_isolation" ON "orders"."order_notes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "refund_requests_tenant_isolation" ON "orders"."refund_requests" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (orders 4 → events 2); new tables, so no NOT VALID needed.
ALTER TABLE "orders"."refund_requests" ADD CONSTRAINT "refund_requests_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "orders"."mass_refunds" ADD CONSTRAINT "mass_refunds_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");
-- hand-written: end
