CREATE TYPE "public"."clock_kind" AS ENUM('in', 'out', 'break_start', 'break_end');--> statement-breakpoint
CREATE TABLE "clock_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "clock_kind" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clock_events_employee_at_idx" ON "clock_events" USING btree ("employee_id","at");