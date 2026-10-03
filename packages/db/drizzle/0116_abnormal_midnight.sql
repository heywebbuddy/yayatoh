CREATE TABLE "donations"."pledge_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"collection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"attempt" integer NOT NULL,
	"gift_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decline_code" text,
	"settled_at" timestamp with time zone,
	CONSTRAINT "pledge_attempts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "pledge_attempts_kind_check" CHECK (kind in ('card', 'link')),
	CONSTRAINT "pledge_attempts_status_check" CHECK (status in ('pending', 'paid', 'failed')),
	CONSTRAINT "pledge_attempts_attempt_check" CHECK (attempt >= 1)
);
--> statement-breakpoint
ALTER TABLE "donations"."pledge_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."pledge_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."pledge_collections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"pledge_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"donor_name" text NOT NULL,
	"donor_email" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text NOT NULL,
	"saved_card_id" uuid,
	"charge_at" timestamp with time zone,
	"card_attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"invoiced_at" timestamp with time zone,
	"due_on" date,
	"paid_at" timestamp with time zone,
	"offline_method" text,
	"offline_reference" text,
	"received_on" date,
	"note" text,
	"closed_by" uuid,
	"settled_by" uuid,
	CONSTRAINT "pledge_collections_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "pledge_collections_status_check" CHECK (status in ('scheduled', 'charging', 'invoiced', 'paid', 'paid_offline', 'written_off')),
	CONSTRAINT "pledge_collections_amount_check" CHECK (amount_minor > 0),
	CONSTRAINT "pledge_collections_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "pledge_collections_card_check" CHECK (status not in ('scheduled', 'charging') or (saved_card_id is not null and charge_at is not null)),
	CONSTRAINT "pledge_collections_invoice_check" CHECK (status <> 'invoiced' or (invoiced_at is not null and due_on is not null)),
	CONSTRAINT "pledge_collections_offline_check" CHECK ((status = 'paid_offline') = (offline_method is not null)),
	CONSTRAINT "pledge_collections_offline_method_check" CHECK (offline_method is null or offline_method in ('check', 'wire', 'stock', 'daf', 'cash', 'other')),
	CONSTRAINT "pledge_collections_paid_check" CHECK ((status in ('paid', 'paid_offline')) = (paid_at is not null)),
	CONSTRAINT "pledge_collections_written_off_check" CHECK (status <> 'written_off' or note is not null),
	CONSTRAINT "pledge_collections_attempts_check" CHECK (card_attempts between 0 and 2)
);
--> statement-breakpoint
ALTER TABLE "donations"."pledge_collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."pledge_collections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."saved_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"party_id" uuid,
	"guest_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"connected_account_id" text NOT NULL,
	"provider_setup_id" text,
	"customer_id" text,
	"payment_method_id" text,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"activated_at" timestamp with time zone,
	"remove_after" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "saved_cards_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "saved_cards_status_check" CHECK (status in ('pending', 'active', 'failed', 'removed')),
	CONSTRAINT "saved_cards_source_check" CHECK (source in ('checkout', 'checkin', 'table', 'party')),
	CONSTRAINT "saved_cards_provider_check" CHECK (provider in ('fake', 'stripe')),
	CONSTRAINT "saved_cards_holder_check" CHECK (num_nonnulls(party_id, guest_id) <= 1),
	CONSTRAINT "saved_cards_active_check" CHECK (status <> 'active' or (customer_id is not null and payment_method_id is not null and activated_at is not null)),
	CONSTRAINT "saved_cards_removed_check" CHECK ((status = 'removed') = (removed_at is not null))
);
--> statement-breakpoint
ALTER TABLE "donations"."saved_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."saved_cards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."pledge_attempts" ADD CONSTRAINT "pledge_attempts_collection_fk" FOREIGN KEY ("org_id","collection_id") REFERENCES "donations"."pledge_collections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."pledge_attempts" ADD CONSTRAINT "pledge_attempts_gift_fk" FOREIGN KEY ("org_id","gift_id") REFERENCES "donations"."gifts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."pledge_collections" ADD CONSTRAINT "pledge_collections_pledge_fk" FOREIGN KEY ("org_id","pledge_id") REFERENCES "donations"."pledges"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."pledge_collections" ADD CONSTRAINT "pledge_collections_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "donations"."campaigns"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."pledge_collections" ADD CONSTRAINT "pledge_collections_card_fk" FOREIGN KEY ("org_id","saved_card_id") REFERENCES "donations"."saved_cards"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pledge_attempts_org_id_idx" ON "donations"."pledge_attempts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pledge_attempts_org_order_key" ON "donations"."pledge_attempts" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pledge_attempts_org_card_attempt_key" ON "donations"."pledge_attempts" USING btree ("org_id","collection_id","attempt") WHERE kind = 'card';--> statement-breakpoint
CREATE INDEX "pledge_attempts_org_collection_idx" ON "donations"."pledge_attempts" USING btree ("org_id","collection_id");--> statement-breakpoint
CREATE INDEX "pledge_collections_org_id_idx" ON "donations"."pledge_collections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pledge_collections_org_pledge_key" ON "donations"."pledge_collections" USING btree ("org_id","pledge_id");--> statement-breakpoint
CREATE INDEX "pledge_collections_org_event_status_idx" ON "donations"."pledge_collections" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "pledge_collections_org_charge_idx" ON "donations"."pledge_collections" USING btree ("org_id","charge_at") WHERE status in ('scheduled', 'charging');--> statement-breakpoint
CREATE INDEX "saved_cards_org_id_idx" ON "donations"."saved_cards" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "saved_cards_org_event_status_idx" ON "donations"."saved_cards" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "saved_cards_org_party_idx" ON "donations"."saved_cards" USING btree ("org_id","party_id") WHERE party_id is not null;--> statement-breakpoint
CREATE INDEX "saved_cards_org_guest_idx" ON "donations"."saved_cards" USING btree ("org_id","guest_id") WHERE guest_id is not null;--> statement-breakpoint
CREATE INDEX "saved_cards_org_remove_idx" ON "donations"."saved_cards" USING btree ("org_id","remove_after") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "saved_cards_org_setup_key" ON "donations"."saved_cards" USING btree ("org_id","provider","provider_setup_id") WHERE provider_setup_id is not null;--> statement-breakpoint
CREATE POLICY "pledge_attempts_tenant_isolation" ON "donations"."pledge_attempts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "pledge_collections_tenant_isolation" ON "donations"."pledge_collections" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "saved_cards_tenant_isolation" ON "donations"."saved_cards" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.8e cross-module composite FKs (donations is tier 5; events tier 2, guests tier 3, orders tier 4).
-- A saved card and a pledge's collection keep their event (consent and money records: an event
-- with them cannot be deleted); a card keeps its consent when its guest or party goes (only the
-- id clears). Each try to collect points at its own order.
ALTER TABLE "donations"."saved_cards" ADD CONSTRAINT "saved_cards_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "donations"."saved_cards" ADD CONSTRAINT "saved_cards_party_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "guests"."parties"("org_id","id") ON DELETE SET NULL ("party_id");--> statement-breakpoint
ALTER TABLE "donations"."saved_cards" ADD CONSTRAINT "saved_cards_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE SET NULL ("guest_id");--> statement-breakpoint
ALTER TABLE "donations"."pledge_collections" ADD CONSTRAINT "pledge_collections_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "donations"."pledge_attempts" ADD CONSTRAINT "pledge_attempts_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id");
-- hand-written: end
