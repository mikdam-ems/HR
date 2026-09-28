CREATE TABLE "client_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "client_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "client_shifts" ADD CONSTRAINT "client_shifts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_shifts_client_idx" ON "client_shifts" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_client_shift_id_client_shifts_id_fk" FOREIGN KEY ("client_shift_id") REFERENCES "public"."client_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Every existing client starts with one "Standard" shift (the 8h30 day).
INSERT INTO "client_shifts" ("client_id", "name", "start_time", "end_time", "break_minutes", "sort_order")
SELECT "id", 'Standard', '09:00', '17:30', 0, 0 FROM "clients";
--> statement-breakpoint
-- Link people already on those hours at their current primary client to that client's shift.
UPDATE "schedules" s SET "client_shift_id" = cs."id"
FROM "assignments" a
JOIN "client_shifts" cs ON cs."client_id" = a."client_id"
WHERE a."employee_id" = s."employee_id" AND a."primary" = true AND a."end_date" IS NULL
  AND s."start_time" = cs."start_time" AND s."end_time" = cs."end_time" AND s."break_minutes" = cs."break_minutes";
