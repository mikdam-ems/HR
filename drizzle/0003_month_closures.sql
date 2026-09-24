CREATE TABLE "month_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"closed_by_id" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "month_closures" ADD CONSTRAINT "month_closures_closed_by_id_employees_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "month_closures_month_idx" ON "month_closures" USING btree ("year","month");