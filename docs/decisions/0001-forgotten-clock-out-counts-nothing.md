# 0001 — A forgotten clock-out counts nothing until corrected

**Date:** 2026-09-28 · **Issues:** #1, #2 · **Shipped in:** v0.1.0 (#30)

## Context

Hours come from clocking in and out. When someone forgot to clock out, the open session kept running until "now", so a
single forgotten day turned into hundreds of hours of overtime (seen live: 541h worked, 473h overtime in one month).

## Decision

A session left open on an earlier day counts **0 hours** and flags the day "Clock-out missing — ask for a correction".
Today's open session still counts live. The person closes it by entering when they left; an approved correction
replaces it.

## Consequences

- Payroll can never be inflated by a forgotten clock-out; the worst case is a missing day that is visibly flagged.
- People must close forgotten sessions before submitting; the morning reminder (#13) and the clock card ask them to.
