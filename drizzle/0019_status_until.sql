ALTER TABLE "employees" ADD COLUMN "status_until" date;--> statement-breakpoint
-- Statuses set before this change were for that day only; keep them that way instead of letting them stay up forever.
UPDATE "employees" SET "status_until" = "status_date" WHERE "status_date" IS NOT NULL;
