CREATE TABLE "orders"."checkout_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"verify_email" boolean DEFAULT true NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "checkout_settings_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "orders"."checkout_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."checkout_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."guest_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"purpose" text NOT NULL,
	"scope_org_id" uuid,
	"email_hash" text NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"link_hash" text,
	"browser_hash" text,
	"link_expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_challenges_purpose_check" CHECK (purpose in ('checkout', 'sign_in')),
	CONSTRAINT "guest_challenges_attempts_check" CHECK (attempts between 0 and 5),
	CONSTRAINT "guest_challenges_email_lower_check" CHECK (email = lower(email)),
	CONSTRAINT "guest_challenges_link_check" CHECK ((link_hash is null) = (link_expires_at is null) and (link_hash is null or browser_hash is not null))
);
--> statement-breakpoint
CREATE TABLE "orders"."guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"scope_org_id" uuid,
	"host" text NOT NULL,
	"email_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_sessions_email_lower_check" CHECK (email = lower(email))
);
--> statement-breakpoint
CREATE INDEX "checkout_settings_org_id_idx" ON "orders"."checkout_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_settings_org_event_key" ON "orders"."checkout_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "guest_challenges_email_idx" ON "orders"."guest_challenges" USING btree ("email_hash","purpose","created_at");--> statement-breakpoint
CREATE INDEX "guest_challenges_expires_idx" ON "orders"."guest_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_challenges_link_key" ON "orders"."guest_challenges" USING btree ("link_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sessions_token_key" ON "orders"."guest_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_sessions_email_idx" ON "orders"."guest_sessions" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "guest_sessions_expires_idx" ON "orders"."guest_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "orders_org_buyer_email_idx" ON "orders"."orders" USING btree ("org_id","buyer_email");--> statement-breakpoint
CREATE POLICY "checkout_settings_tenant_isolation" ON "orders"."checkout_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FK, down the tiers (orders 4 → events 2); a new table, so no NOT VALID needed.
ALTER TABLE "orders"."checkout_settings" ADD CONSTRAINT "checkout_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
-- Guest challenges and sessions (global, M1.5f) are reached only by app_user through @yayatoh/orders;
-- the staff reader has no business with codes, links or attendee sessions.
REVOKE ALL ON orders.guest_challenges FROM platform_reader;
--> statement-breakpoint
REVOKE ALL ON orders.guest_sessions FROM platform_reader;
--> statement-breakpoint
REVOKE TRUNCATE ON orders.guest_challenges, orders.guest_sessions FROM app_user;
--> statement-breakpoint
-- The marketplace "My tickets" list and "email me my order links" look a verified address up across
-- orgs through the function below; this index serves it (the org-leading one serves tenant pages).
-- Built in the migration transaction: fine before launch (no production data); after launch a
-- new index on orders must be CONCURRENTLY in its own migration.
CREATE INDEX "orders_buyer_email_idx" ON "orders"."orders" USING btree ("buyer_email");
--> statement-breakpoint
-- A verified buyer's orders across orgs → (org, order) ids only, sold orders, newest first.
CREATE FUNCTION orders.order_refs_by_email(p_email text)
RETURNS TABLE (org_id uuid, order_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT o.org_id, o.id FROM orders.orders o
  JOIN tenancy.organizations g ON g.id = o.org_id AND g.status = 'active'
  WHERE o.buyer_email = lower(p_email) AND o.status IN ('paid', 'partially_refunded', 'refunded')
  ORDER BY o.created_at DESC
  LIMIT 200
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orders.order_refs_by_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orders.order_refs_by_email(text) TO app_user;
-- hand-written: end
