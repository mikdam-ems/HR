-- A full working day at EMS is 8h30 (09:00–17:30). Move the standard 09:00–17:00 schedules to it.
-- Custom shifts (other start or end times) are left as they are.
UPDATE "schedules" SET "end_time" = '17:30' WHERE "start_time" = '09:00' AND "end_time" = '17:00';
