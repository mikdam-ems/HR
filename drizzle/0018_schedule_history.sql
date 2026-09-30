-- Issue #3. Written on 28 Sept 2026 as 0011/0012 on a branch that was never merged; it runs here as 0018, after
-- migrations 0011–0017, none of which change schedule times, so it does the same job.
--
-- 0010 moved 09:00–17:00 schedules to 17:30 in place, which also changed every past day's expected hours and
-- so the overtime of months already approved or closed (issue #3). Schedules are versioned by effective_from,
-- so put history back and start the 8h30 day as a new version from 1 October 2026.
-- Before 0010 no standard schedule ended at 17:30, so every 09:00–17:30 version before the cut-over came from it.
-- Runs after 0011 (client shifts), which linked those versions to their client's Standard 09:00–17:30 shift:
-- the link moves to the October version, and the restored 09:00–17:00 history becomes custom hours.

-- The version in force on the cut-over gets a 09:00–17:30 successor from 2026-10-01.
INSERT INTO "schedules" ("employee_id", "effective_from", "start_time", "end_time", "break_minutes", "shift_code", "client_shift_id")
SELECT s."employee_id", '2026-10-01', '09:00', '17:30', s."break_minutes", s."shift_code", s."client_shift_id"
FROM "schedules" s
WHERE s."start_time" = '09:00' AND s."end_time" = '17:30' AND s."effective_from" < '2026-10-01'
  AND NOT EXISTS (
    SELECT 1 FROM "schedules" later
    WHERE later."employee_id" = s."employee_id" AND later."effective_from" > s."effective_from" AND later."effective_from" <= '2026-10-01'
  )
ON CONFLICT ("employee_id", "effective_from") DO NOTHING;
--> statement-breakpoint
-- Before the cut-over they go back to the 09:00–17:00 they were worked and approved under.
UPDATE "schedules" SET "end_time" = '17:00', "client_shift_id" = NULL
WHERE "start_time" = '09:00' AND "end_time" = '17:30' AND "effective_from" < '2026-10-01';
