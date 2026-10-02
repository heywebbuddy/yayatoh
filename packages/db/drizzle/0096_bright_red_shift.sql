ALTER TABLE "auth"."users" ADD COLUMN "theme" text;--> statement-breakpoint
-- hand-written: begin (design system v2, ADR 0022)
-- The CHECK on an existing table is added NOT VALID, then validated (no long lock).
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_theme_check" CHECK (theme is null or theme in ('light', 'dark', 'system')) NOT VALID;--> statement-breakpoint
ALTER TABLE "auth"."users" VALIDATE CONSTRAINT "users_theme_check";
-- hand-written: end
