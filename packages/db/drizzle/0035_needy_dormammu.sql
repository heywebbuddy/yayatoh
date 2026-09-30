ALTER TABLE "orders"."orders" ADD COLUMN "collected_by" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "payment_reference" text;--> statement-breakpoint
-- Existing table: NOT VALID + VALIDATE keeps the lock short (expand/contract).
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_collected_by_check" CHECK (collected_by in ('platform', 'organizer')) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_collected_by_check";--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_payment_method_check" CHECK (payment_method is null or payment_method in ('cash', 'zelle', 'card_terminal', 'other')) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders"."orders" VALIDATE CONSTRAINT "orders_payment_method_check";