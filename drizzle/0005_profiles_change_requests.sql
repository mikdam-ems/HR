CREATE TYPE "public"."change_action" AS ENUM('set', 'reset');--> statement-breakpoint
CREATE TABLE "day_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"action" "change_action" NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"start_time" text,
	"end_time" text,
	"leave_type" "leave_type",
	"leave_portion" numeric,
	"note" text,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"manager_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_photos" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"data_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "status_emoji" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "status_text" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "status_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "photo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "day_change_requests" ADD CONSTRAINT "day_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_change_requests" ADD CONSTRAINT "day_change_requests_decided_by_id_employees_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_photos" ADD CONSTRAINT "employee_photos_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "day_change_requests_employee_idx" ON "day_change_requests" USING btree ("employee_id","date");