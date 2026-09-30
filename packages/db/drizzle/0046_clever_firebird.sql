-- M1.2c: per-person security audit, the session's step-up time and the payout-destination hold.
-- New nullable columns without defaults are metadata-only (no rewrite); migrate.ts sets lock_timeout.
CREATE TABLE "auth"."security_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "step_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments"."payment_accounts" ADD COLUMN "destination_hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_events_user_created_idx" ON "auth"."security_events" USING btree ("user_id","created_at");