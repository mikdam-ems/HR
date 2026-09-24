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
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and commit the new file in `drizzle/`.
- Before pushing: `npm test && npm run typecheck && npm run build`.
