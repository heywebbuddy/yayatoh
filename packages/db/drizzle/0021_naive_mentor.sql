-- Added NOT VALID, then validated: no long lock on existing attendee rows.
ALTER TABLE "attendees"."attendees" ADD CONSTRAINT "attendees_labels_check" CHECK (cardinality(labels) <= 20) NOT VALID;--> statement-breakpoint
ALTER TABLE "attendees"."attendees" VALIDATE CONSTRAINT "attendees_labels_check";
