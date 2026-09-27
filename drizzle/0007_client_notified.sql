ALTER TABLE "clients" ADD COLUMN "is_internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "leave_contact" text;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "client_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "client_notified_note" text;--> statement-breakpoint
UPDATE "clients" SET "is_internal" = true WHERE "name_en" = 'EMS Internal';
