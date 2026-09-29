CREATE TABLE "seasonal_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"client_shift_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seasonal_hours" ADD CONSTRAINT "seasonal_hours_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasonal_hours" ADD CONSTRAINT "seasonal_hours_client_shift_id_client_shifts_id_fk" FOREIGN KEY ("client_shift_id") REFERENCES "public"."client_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seasonal_hours_client_idx" ON "seasonal_hours" USING btree ("client_id");