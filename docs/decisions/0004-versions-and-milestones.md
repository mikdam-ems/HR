# 0004 — One version number everywhere

**Date:** 2026-09-30 · **Issue:** #33

## Context

We need to know exactly what is running, what shipped when, and what is planned next, and to move between phases
safely (pilot, go-live) without guessing which changes are in which build.

## Decision

Each version has one number, used in five places that must agree:

1. the **milestone** on GitHub (`v0.2 — Pilot`), which groups the issues planned for it;
2. the heading in **`CHANGELOG.md`** (`## v0.2.0 — <date>`);
3. **`package.json`** `version`;
4. the **GitHub Release** and its tag (`v0.2.0`), published automatically;
5. the running app, shown at **`/api/health`** (`"version": "0.2.0"`).

The release workflow refuses to publish when `package.json` and the changelog disagree. Numbers follow
`0.MINOR.PATCH` until go-live, which is **v1.0.0**: a batch of features raises MINOR, a batch of fixes only raises
PATCH.

## Consequences

- Shipping a version is one pull request that bumps `package.json` and turns **Unreleased** into the version.
- Pilot feedback names the version it was seen in, so it can be matched to exactly what was running.
