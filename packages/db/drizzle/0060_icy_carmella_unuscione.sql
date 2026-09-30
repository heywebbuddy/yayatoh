-- M1.9e: one fraud-signal model. checkin.fraud_signals (M1.9c2a/M1.9d) also takes checkout risk
-- outcomes and chat reports (raised by outbox subscribers), with a source, the source event (once
-- per event), an order/contact/conversation subject and a triage note; a new notification
-- category `security` carries the high-severity alerts. Expand-only: nullable columns, a relaxed
-- NOT NULL, widened checks (add v2 NOT VALID → validate → drop → rename). migrate.ts sets lock_timeout.
ALTER TABLE "checkin"."fraud_signals" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "source" text DEFAULT 'checkin' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "fraud_signals_org_order_idx" ON "checkin"."fraud_signals" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "fraud_signals_org_ticket_idx" ON "checkin"."fraud_signals" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fraud_signals_org_source_event_key" ON "checkin"."fraud_signals" USING btree ("org_id","source_event_id") WHERE source_event_id is not null;--> statement-breakpoint
-- hand-written: begin
-- New checks on an existing table: NOT VALID, then VALIDATE (no long lock).
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_source_check" CHECK (source in ('checkin', 'checkout', 'chat')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_source_check";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_event_check" CHECK (event_id is not null or source = 'chat') NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_event_check";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_note_check" CHECK (resolution_note is null or length(resolution_note) between 1 and 500) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_note_check";--> statement-breakpoint
-- Widened checks: add *_v2, validate, drop the old one, rename (as in 0020 and 0048).
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_kind_check_v2" CHECK (kind in ('two_entrances', 'invalid_burst', 'device_velocity', 'impossible_travel', 'rejected_burst', 'purchase_velocity', 'country_mismatch', 'checkout_blocked', 'card_testing', 'chat_abuse')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_kind_check_v2";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" DROP CONSTRAINT "fraud_signals_kind_check";--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" RENAME CONSTRAINT "fraud_signals_kind_check_v2" TO "fraud_signals_kind_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" ADD CONSTRAINT "messages_category_check_v2" CHECK (category in ('transactional', 'reminders', 'event_updates', 'marketing', 'sales', 'messages', 'security')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."messages" VALIDATE CONSTRAINT "messages_category_check_v2";--> statement-breakpoint
ALTER TABLE "notifications"."messages" DROP CONSTRAINT "messages_category_check";--> statement-breakpoint
ALTER TABLE "notifications"."messages" RENAME CONSTRAINT "messages_category_check_v2" TO "messages_category_check";--> statement-breakpoint
ALTER TABLE "notifications"."preferences" ADD CONSTRAINT "preferences_category_check_v2" CHECK (category in ('transactional', 'reminders', 'event_updates', 'marketing', 'sales', 'messages', 'security')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."preferences" VALIDATE CONSTRAINT "preferences_category_check_v2";--> statement-breakpoint
ALTER TABLE "notifications"."preferences" DROP CONSTRAINT "preferences_category_check";--> statement-breakpoint
ALTER TABLE "notifications"."preferences" RENAME CONSTRAINT "preferences_category_check_v2" TO "preferences_category_check";--> statement-breakpoint
-- A checkout signal's order belongs to the same org (FK down the tiers; modules never import
-- each other's schema). Contacts and conversations can be erased (DSAR), so they carry no FK.
ALTER TABLE "checkin"."fraud_signals" ADD CONSTRAINT "fraud_signals_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."fraud_signals" VALIDATE CONSTRAINT "fraud_signals_order_fk";--> statement-breakpoint
-- hand-written: end
