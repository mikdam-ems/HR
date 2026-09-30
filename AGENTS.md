<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# EMS People & Culture — project notes

- Business rules live in `src/domain/` (pure TypeScript, no framework). Every rule has a test in `src/domain/__tests__/`. Change rules there first, test-first.
- Database access and mutations live in `src/server/` and take a `DB` plus the acting user's id; every mutation writes to `audit_log`. Pages and server actions in `src/app/` stay thin.
- Every server action must start with `requirePermission(...)` from `src/server/session.ts`.
- All UI text goes through `src/i18n/en.ts` and `src/i18n/ar.ts` (keep both in sync). Use logical CSS properties (`inline-start`/`inline-end`) so Arabic RTL works.
- Brand colours are CSS variables in `src/app/globals.css`. Text on the green (`--brand-600`) is `--brand-950`, never white.
- A second brand, Kadr (`html[data-brand='kadr']`, block at the end of `globals.css`), remaps the same tokens to cobalt; there, `--on-accent` is white. Style with the tokens (`--accent`, `--on-accent`, `--brand-*`, `--r-*`) rather than literal colours so both brands keep working. `src/brand` decides which brand a page gets.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and commit the new file in `drizzle/`.
- Before pushing: `npm test && npm run typecheck && npm run build`, and `npm run test:e2e` when pages or flows change.
  When a feature changes what people click, extend `e2e/walkthrough.e2e.ts` in the same change.
- Log all work on GitHub, so everything is traceable: every change starts from an issue (open one for bugs or ideas
  raised in chat), arrives as a pull request whose description says `Closes #N`, and adds a plain-language line to
  `CHANGELOG.md` under **Unreleased** when it changes what people see or how hours, leave or payroll count. When a
  batch ships, turn **Unreleased** into a version; merging it publishes the GitHub Release. Details:
  `docs/HOW_WE_WORK.md`.
- The `clean-code` skill (`.claude/skills/clean-code`) is general guidance. Where it differs, this project's conventions win: server functions return a `Result` (`ok` / `fail`) instead of throwing, functions return `null`/`undefined` for "not found", and short comments explaining *why* are welcome.
