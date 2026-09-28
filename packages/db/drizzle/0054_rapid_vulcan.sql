-- M1.2d central login (handoff codes, host-bound sessions), M1.2e staff impersonation, and
-- TOTP replay protection (M1.2c leftover). Global identity tables (GLOBAL_TABLES): no RLS.
CREATE TABLE "auth"."handoff_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"host" text NOT NULL,
	"return_path" text NOT NULL,
	"state_hash" text,
	"impersonation_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."impersonations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"return_url" text NOT NULL,
	"ip_address" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text
);
--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "host" text;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "impersonation_id" uuid;--> statement-breakpoint
ALTER TABLE "auth"."two_factors" ADD COLUMN "last_used_step" bigint;--> statement-breakpoint
ALTER TABLE "auth"."handoff_codes" ADD CONSTRAINT "handoff_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."handoff_codes" ADD CONSTRAINT "handoff_codes_impersonation_id_impersonations_id_fk" FOREIGN KEY ("impersonation_id") REFERENCES "auth"."impersonations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."impersonations" ADD CONSTRAINT "impersonations_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."impersonations" ADD CONSTRAINT "impersonations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_codes_code_hash_key" ON "auth"."handoff_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "handoff_codes_user_idx" ON "auth"."handoff_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "handoff_codes_expires_idx" ON "auth"."handoff_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "impersonations_org_started_idx" ON "auth"."impersonations" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "impersonations_staff_idx" ON "auth"."impersonations" USING btree ("staff_user_id","started_at");--> statement-breakpoint
CREATE INDEX "impersonations_open_idx" ON "auth"."impersonations" USING btree ("expires_at") WHERE "auth"."impersonations"."ended_at" is null;--> statement-breakpoint
-- hand-written: begin
-- Existing table: NOT VALID + VALIDATE keeps the lock short (expand/contract).
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_impersonation_id_impersonations_id_fk" FOREIGN KEY ("impersonation_id") REFERENCES "auth"."impersonations"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "auth"."sessions" VALIDATE CONSTRAINT "sessions_impersonation_id_impersonations_id_fk";
-- hand-written: end
--> statement-breakpoint
CREATE INDEX "sessions_impersonation_idx" ON "auth"."sessions" USING btree ("impersonation_id") WHERE "auth"."sessions"."impersonation_id" is not null;