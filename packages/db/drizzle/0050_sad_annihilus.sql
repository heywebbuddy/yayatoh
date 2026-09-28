ALTER TABLE "seating"."event_seats" DROP CONSTRAINT "event_seats_block_check";--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" DROP CONSTRAINT "seat_assignments_prior_block_check";--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ADD COLUMN "group_label" text;--> statement-breakpoint
CREATE INDEX "event_seats_org_event_group_idx" ON "seating"."event_seats" USING btree ("org_id","event_id","group_label") WHERE group_label is not null;--> statement-breakpoint
-- hand-written: begin (existing tables: NOT VALID + VALIDATE keeps the locks short; every row already satisfies them)
-- M1.8f: seats kept back for a group ('group', named by group_label); a group member's seat remembers it.
ALTER TABLE "seating"."event_seats" ADD CONSTRAINT "event_seats_group_check" CHECK ((block_reason is distinct from 'group' or group_label is not null) and (group_label is null or length(group_label) between 1 and 40)) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" VALIDATE CONSTRAINT "event_seats_group_check";--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ADD CONSTRAINT "event_seats_block_check" CHECK ((status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in ('channel', 'ada', 'kill', 'assigned', 'group'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" VALIDATE CONSTRAINT "event_seats_block_check";--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" ADD CONSTRAINT "seat_assignments_prior_block_check" CHECK (prior_block is null or prior_block in ('channel', 'ada', 'group')) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" VALIDATE CONSTRAINT "seat_assignments_prior_block_check";
-- hand-written: end
