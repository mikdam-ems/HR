CREATE TYPE "public"."work_location" AS ENUM('office', 'client_site', 'remote');--> statement-breakpoint
ALTER TABLE "clock_events" ADD COLUMN "location" "work_location";