# 0003 — Where hours come from is dated, never global

**Date:** 2026-09-28 · **Issue:** #4 · **Shipped in:** v0.1.0 (#30)

## Context

"Timesheet hours come from: clock / schedule" was one setting applied to every month whenever it was viewed. Flipping
it rewrote approved and closed months (the same September showed 486h overtime or none, depending on the switch).

## Decision

The setting is a list of **dated periods**: from each date on, the clock or the schedule. A switch can't start before
the latest switch, or in or before a closed month, and it is audited. Default: the schedule until 30 September 2026,
the clock from 1 October 2026.

## Consequences

- Switching never changes days before its date.
- A month can use both sources if a switch falls mid-month; each day says where its hours came from (#10).
