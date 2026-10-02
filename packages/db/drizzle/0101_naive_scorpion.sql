-- M3.8b marketing analytics: the domain an email went out from (deliverability per sending domain).
-- Expand only: a nullable column (metadata-only change) and a CHECK added NOT VALID, then validated.
ALTER TABLE "notifications"."messages" ADD COLUMN "sender_domain" text;--> statement-breakpoint
-- hand-written: begin (M3.8b)
-- The CHECK on an existing table is added NOT VALID, then validated (drizzle-kit emits a plain ADD).
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_sender_domain_check" CHECK (sender_domain is null or (sender_domain = lower(sender_domain) and length(sender_domain) between 4 and 253)) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_sender_domain_check";
-- hand-written: end
