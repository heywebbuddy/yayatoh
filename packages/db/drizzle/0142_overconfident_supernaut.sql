CREATE TABLE "badges"."kiosk_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"ticket_id" uuid,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "kiosk_challenges_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "kiosk_challenges_outcome_check" CHECK (outcome in ('ticket', 'desk', 'none')),
	CONSTRAINT "kiosk_challenges_ticket_check" CHECK ((outcome = 'ticket') = (ticket_id is not null)),
	CONSTRAINT "kiosk_challenges_attempts_check" CHECK (attempts between 0 and 5),
	CONSTRAINT "kiosk_challenges_code_hash_check" CHECK (code_hash ~ '^[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
ALTER TABLE "badges"."kiosk_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."kiosk_challenges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "badges"."kiosk_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"printer_id" uuid,
	"email_codes" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "kiosk_settings_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "badges"."kiosk_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."kiosk_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."kiosk_settings" ADD CONSTRAINT "kiosk_settings_printer_fk" FOREIGN KEY ("org_id","printer_id") REFERENCES "badges"."printers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kiosk_challenges_org_id_idx" ON "badges"."kiosk_challenges" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "kiosk_challenges_org_device_idx" ON "badges"."kiosk_challenges" USING btree ("org_id","device_id","created_at");--> statement-breakpoint
CREATE INDEX "kiosk_challenges_org_expires_idx" ON "badges"."kiosk_challenges" USING btree ("org_id","expires_at");--> statement-breakpoint
CREATE INDEX "kiosk_settings_org_id_idx" ON "badges"."kiosk_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_settings_org_event_key" ON "badges"."kiosk_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "kiosk_challenges_tenant_isolation" ON "badges"."kiosk_challenges" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "kiosk_settings_tenant_isolation" ON "badges"."kiosk_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (badges 5 → events 2, ticketing 3); new tables, so no NOT VALID needed.
ALTER TABLE "badges"."kiosk_settings" ADD CONSTRAINT "kiosk_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "badges"."kiosk_challenges" ADD CONSTRAINT "kiosk_challenges_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "badges"."kiosk_challenges" ADD CONSTRAINT "kiosk_challenges_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;
-- hand-written: end
