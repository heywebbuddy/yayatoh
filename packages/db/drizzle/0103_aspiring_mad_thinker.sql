CREATE TABLE "registration"."reason_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"label" text NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "reason_templates_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "reason_templates_decision_check" CHECK (decision in ('approve', 'deny')),
	CONSTRAINT "reason_templates_text_check" CHECK (length(btrim(label)) between 1 and 80 and length(btrim(body)) between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "registration"."reason_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."reason_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."registrants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_type_id" uuid NOT NULL,
	"admission_item_id" uuid NOT NULL,
	"add_on_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"job_title" text,
	"message" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"decision_source" text,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"order_id" uuid,
	"ticket_id" uuid,
	"host_registrant_id" uuid,
	"substitutions" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "registrants_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "registrants_status_check" CHECK (status in ('pending', 'approved', 'reserved', 'confirmed', 'denied', 'cancelled')),
	CONSTRAINT "registrants_decision_source_check" CHECK (decision_source is null or decision_source in ('open', 'auto_domain', 'auto_member', 'manual')),
	CONSTRAINT "registrants_name_check" CHECK (length(btrim(name)) between 1 and 120),
	CONSTRAINT "registrants_email_check" CHECK (email = lower(email) and length(email) between 3 and 254),
	CONSTRAINT "registrants_answers_check" CHECK (coalesce(length(company), 0) <= 120 and coalesce(length(job_title), 0) <= 120 and coalesce(length(message), 0) <= 2000 and coalesce(length(decision_reason), 0) <= 1000),
	CONSTRAINT "registrants_confirmed_check" CHECK (status <> 'confirmed' or order_id is not null)
);
--> statement-breakpoint
ALTER TABLE "registration"."registrants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."registrants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."type_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_type_id" uuid NOT NULL,
	"email" text NOT NULL,
	"source" text DEFAULT 'csv' NOT NULL,
	CONSTRAINT "type_members_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "type_members_source_check" CHECK (source in ('csv', 'audience')),
	CONSTRAINT "type_members_email_check" CHECK (email = lower(email) and length(email) between 3 and 254)
);
--> statement-breakpoint
ALTER TABLE "registration"."type_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."type_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD COLUMN "approval" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD COLUMN "auto_approve_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD COLUMN "kind" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD COLUMN "guests_per_host" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD COLUMN "substitution_cutoff_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration"."registrants" ADD CONSTRAINT "registrants_type_fk" FOREIGN KEY ("org_id","registration_type_id") REFERENCES "registration"."registration_types"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration"."registrants" ADD CONSTRAINT "registrants_item_fk" FOREIGN KEY ("org_id","admission_item_id") REFERENCES "registration"."admission_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration"."registrants" ADD CONSTRAINT "registrants_host_fk" FOREIGN KEY ("org_id","host_registrant_id") REFERENCES "registration"."registrants"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration"."type_members" ADD CONSTRAINT "type_members_type_fk" FOREIGN KEY ("org_id","registration_type_id") REFERENCES "registration"."registration_types"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reason_templates_org_id_idx" ON "registration"."reason_templates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "reason_templates_org_event_idx" ON "registration"."reason_templates" USING btree ("org_id","event_id","decision");--> statement-breakpoint
CREATE INDEX "registrants_org_id_idx" ON "registration"."registrants" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "registrants_org_event_status_idx" ON "registration"."registrants" USING btree ("org_id","event_id","status","created_at");--> statement-breakpoint
CREATE INDEX "registrants_org_order_idx" ON "registration"."registrants" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "registrants_org_type_idx" ON "registration"."registrants" USING btree ("org_id","registration_type_id","status");--> statement-breakpoint
CREATE INDEX "registrants_org_event_email_idx" ON "registration"."registrants" USING btree ("org_id","event_id","email");--> statement-breakpoint
CREATE INDEX "registrants_org_host_idx" ON "registration"."registrants" USING btree ("org_id","host_registrant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrants_org_ticket_key" ON "registration"."registrants" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrants_org_open_application_key" ON "registration"."registrants" USING btree ("org_id","registration_type_id","email") WHERE status in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "type_members_org_id_idx" ON "registration"."type_members" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "type_members_org_type_email_key" ON "registration"."type_members" USING btree ("org_id","registration_type_id","email");--> statement-breakpoint
CREATE INDEX "type_members_org_event_idx" ON "registration"."type_members" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capacity_claims_org_order_type_key" ON "registration"."capacity_claims" USING btree ("org_id","order_id","registration_type_id");--> statement-breakpoint
-- hand-written: begin (M5.1c: the new per-type claim index is built before the old one goes)
DROP INDEX "registration"."capacity_claims_org_order_key";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M5.1c: CHECKs on the existing registration_types table added NOT VALID, then validated)
ALTER TABLE "registration"."registration_types" ADD CONSTRAINT "registration_types_approval_check" CHECK (approval in ('none', 'manual') and cardinality(auto_approve_domains) <= 20 and (approval = 'manual' or cardinality(auto_approve_domains) = 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" ADD CONSTRAINT "registration_types_guest_check" CHECK (kind in ('standard', 'guest') and guests_per_host between 1 and 10 and substitution_cutoff_hours between 0 and 720) NOT VALID;--> statement-breakpoint
ALTER TABLE "registration"."registration_types" VALIDATE CONSTRAINT "registration_types_approval_check";--> statement-breakpoint
ALTER TABLE "registration"."registration_types" VALIDATE CONSTRAINT "registration_types_guest_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "reason_templates_tenant_isolation" ON "registration"."reason_templates" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "registrants_tenant_isolation" ON "registration"."registrants" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "type_members_tenant_isolation" ON "registration"."type_members" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M5.1c: cross-module foreign keys, down the tiers: registration 5 → events 2, orders 4, ticketing 3)
ALTER TABLE "registration"."registrants" ADD CONSTRAINT "registrants_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."registrants" ADD CONSTRAINT "registrants_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id");--> statement-breakpoint
ALTER TABLE "registration"."registrants" ADD CONSTRAINT "registrants_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id");--> statement-breakpoint
ALTER TABLE "registration"."type_members" ADD CONSTRAINT "type_members_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."reason_templates" ADD CONSTRAINT "reason_templates_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end--> statement-breakpoint
-- hand-written: begin (M5.1c: registration's managed passes take up to 20 per order, one per named registrant of a group; before launch, so a plain update)
UPDATE "ticketing"."ticket_types" SET "max_per_order" = 20 WHERE "managed_by" = 'registration' AND "max_per_order" = 1;
-- hand-written: end
