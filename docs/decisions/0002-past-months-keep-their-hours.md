# 0002 — Past months keep the hours they were worked under

**Date:** 2026-09-28 · **Issue:** #3 · **Shipped in:** v0.1.0 (#30)

## Context

The full day changed from 8h to 8h30. A migration rewrote existing schedules in place, and because schedules are
versioned, every past day's expected hours changed too, and with them the overtime of months already approved or
closed.

## Decision

Schedule changes are always a **new dated version**, never an edit of an old one. The 8h30 day starts on
**1 October 2026**; September and earlier keep the 8h day. Migration `0018_schedule_history` repairs databases where
the rewrite already ran.

## Consequences

- An approved or closed month never changes because a rule changed later.
- A schedule change entered *before* its start date can be overtaken by a later version that already exists (seen on
  30 September with the 1 October version). The person page shows the versions, so an admin can check.
