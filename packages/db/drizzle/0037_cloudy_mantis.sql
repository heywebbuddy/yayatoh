ALTER TABLE "orders"."orders" ADD COLUMN "seat_uuids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing"."tickets" ADD COLUMN "seat_label" text;