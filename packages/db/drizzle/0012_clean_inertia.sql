CREATE SCHEMA "attendees";
--> statement-breakpoint
CREATE SCHEMA "crm";
--> statement-breakpoint
CREATE TABLE "attendees"."attendees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" text NOT NULL,
	"ticket_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "attendees_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "attendees_source_check" CHECK (source in ('ticket', 'registration', 'guest', 'import', 'comp')),
	CONSTRAINT "attendees_status_check" CHECK (status in ('active', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "attendees"."attendees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendees"."attendees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."consents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"evidence" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "consents_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "consents_channel_check" CHECK (channel in ('email', 'sms')),
	CONSTRAINT "consents_purpose_check" CHECK (purpose in ('marketing')),
	CONSTRAINT "consents_status_check" CHECK (status in ('granted', 'withdrawn', 'unknown_legacy'))
);
--> statement-breakpoint
ALTER TABLE "crm"."consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."consents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"email_norm" text NOT NULL,
	"name" text,
	"phone_e164" text,
	"user_id" uuid,
	"merged_into" uuid,
	"source" text NOT NULL,
	CONSTRAINT "contacts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contacts_email_norm_check" CHECK (email_norm = lower(btrim(email_norm)) and email_norm like '%@%'),
	CONSTRAINT "contacts_phone_check" CHECK (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "contacts_source_check" CHECK (source in ('checkout', 'ticket', 'import', 'manual', 'legacy'))
);
--> statement-breakpoint
ALTER TABLE "crm"."contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "buyer_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."consents" ADD CONSTRAINT "consents_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendees_org_id_idx" ON "attendees"."attendees" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "attendees_org_event_idx" ON "attendees"."attendees" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "attendees_org_contact_idx" ON "attendees"."attendees" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendees_org_ticket_key" ON "attendees"."attendees" USING btree ("org_id","ticket_id") WHERE ticket_id is not null;--> statement-breakpoint
CREATE INDEX "consents_org_id_idx" ON "crm"."consents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "consents_org_contact_idx" ON "crm"."consents" USING btree ("org_id","contact_id","channel","purpose","captured_at");--> statement-breakpoint
CREATE INDEX "contacts_org_id_idx" ON "crm"."contacts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_email_norm_key" ON "crm"."contacts" USING btree ("org_id","email_norm");--> statement-breakpoint
CREATE POLICY "attendees_tenant_isolation" ON "attendees"."attendees" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "consents_tenant_isolation" ON "crm"."consents" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "contacts_tenant_isolation" ON "crm"."contacts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- Cross-module foreign keys (hand-written so modules never import each other's schema).
-- Each points down the tiers: attendees (2) → crm (1), orders (4) → crm (1), ticketing (3) → attendees (2).
-- Existing tables get NOT VALID + VALIDATE so the ADD takes only a brief lock.
ALTER TABLE "attendees"."attendees" ADD CONSTRAINT "attendees_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id");--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_buyer_contact_fk" FOREIGN KEY ("org_id","buyer_contact_id") REFERENCES "crm"."contacts"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_buyer_contact_fk";--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" ADD CONSTRAINT "tickets_attendee_fk" FOREIGN KEY ("org_id","attendee_id") REFERENCES "attendees"."attendees"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" VALIDATE CONSTRAINT "tickets_attendee_fk";--> statement-breakpoint
CREATE INDEX "orders_org_buyer_contact_idx" ON "orders"."orders" USING btree ("org_id","buyer_contact_id");--> statement-breakpoint
CREATE INDEX "tickets_org_attendee_idx" ON "ticketing"."tickets" USING btree ("org_id","attendee_id");
