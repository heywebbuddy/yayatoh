CREATE TABLE "ticketing"."signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kid" integer NOT NULL,
	"public_key" text NOT NULL,
	"private_key_ciphertext" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "signing_keys_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "signing_keys_kid_check" CHECK (kid between 1 and 65535)
);
--> statement-breakpoint
ALTER TABLE "ticketing"."signing_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."signing_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticketing"."ticket_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"format" text NOT NULL,
	"instance" text,
	"payload" text NOT NULL,
	"rev" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ticket_barcodes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "ticket_barcodes_format_check" CHECK (format in ('yy1', 'legacy_eventmie'))
);
--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_barcodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_barcodes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticketing"."tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"serial" integer NOT NULL,
	"short_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"rev" integer DEFAULT 0 NOT NULL,
	"holder_name" text NOT NULL,
	"holder_email" text NOT NULL,
	"attendee_id" uuid,
	CONSTRAINT "tickets_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "tickets_status_check" CHECK (status in ('active', 'void')),
	CONSTRAINT "tickets_rev_check" CHECK (rev between 0 and 65535)
);
--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_barcodes" ADD CONSTRAINT "ticket_barcodes_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" ADD CONSTRAINT "tickets_ticket_type_fk" FOREIGN KEY ("org_id","ticket_type_id") REFERENCES "ticketing"."ticket_types"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signing_keys_org_id_idx" ON "ticketing"."signing_keys" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_keys_org_kid_key" ON "ticketing"."signing_keys" USING btree ("org_id","kid");--> statement-breakpoint
CREATE INDEX "ticket_barcodes_org_id_idx" ON "ticketing"."ticket_barcodes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_barcodes_org_payload_key" ON "ticketing"."ticket_barcodes" USING btree ("org_id","payload");--> statement-breakpoint
CREATE INDEX "ticket_barcodes_org_ticket_idx" ON "ticketing"."ticket_barcodes" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_org_id_idx" ON "ticketing"."tickets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_org_event_serial_key" ON "ticketing"."tickets" USING btree ("org_id","event_id","serial");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_org_short_code_key" ON "ticketing"."tickets" USING btree ("org_id","short_code");--> statement-breakpoint
CREATE INDEX "tickets_org_order_idx" ON "ticketing"."tickets" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE POLICY "signing_keys_tenant_isolation" ON "ticketing"."signing_keys" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "ticket_barcodes_tenant_isolation" ON "ticketing"."ticket_barcodes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "tickets_tenant_isolation" ON "ticketing"."tickets" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));