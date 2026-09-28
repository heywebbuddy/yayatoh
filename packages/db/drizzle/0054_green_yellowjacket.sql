ALTER TABLE "tenancy"."api_keys" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- hand-written: begin (M1.13d test keys; existing table: NOT VALID + VALIDATE keeps the lock short, every existing row is a live key)
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_sandbox_check" CHECK ((not sandbox and starts_with(prefix, 'yy_live_')) or (sandbox and starts_with(prefix, 'yy_test_') and scopes <@ array['org:read', 'events:read']::text[])) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" VALIDATE CONSTRAINT "api_keys_sandbox_check";
-- hand-written: end
