# How we work

Everything we plan, build, test and ship is tracked on GitHub, so anyone can follow what's happening and why.

## The flow

1. **Every piece of work starts as an issue.** Use **New issue → Feature** or **Bug**. A feature says *why*, *what*, and a
   **Done when** checklist anyone can try in the app. Pilot feedback becomes issues too (label `pilot-feedback`).
2. **The issue goes on the project board** (the repo's **Projects** tab): *Backlog → Next → In progress → In review → Done*.
   The **Roadmap** view shows the same issues on a timeline by target month.
3. **Work happens on a branch and arrives as a pull request.** Its description says `Closes #12`, so merging it closes the
   issue and moves the card to *Done*. Nothing is pushed straight to the main branch.
4. **Every pull request is tested automatically.** The **Checks** run (`.github/workflows/ci.yml`) has two jobs:
   - **Tests, typecheck and build:** the rules and database tests (`npm test`), the typecheck and the build.
   - **End-to-end in a browser:** `npm run test:e2e` starts the app on a fresh demo database and plays a week at EMS
     in Chromium, as the people who'd do it (`e2e/walkthrough.e2e.ts`). If a step breaks, the run keeps a screenshot of
     the page (the `e2e-results` download on the run).

   A red cross means it isn't ready. When a feature changes what people click, extend the walkthrough in the same pull
   request. The pull request checklist also covers what a machine can't judge: how it looks in Arabic and both brands.
5. **The pull request adds its line to the release notes** (`CHANGELOG.md`, under **Unreleased**), in plain words.
6. **Someone reviews and merges.** Then it goes to the pilot site.
7. **Each shipped batch gets a release** on the repo's **Releases** page, published automatically (see below).

Nothing is done "off the record": a bug reported in chat or a meeting becomes an issue first, and every change
arrives through a pull request that links it.

## Release notes

`CHANGELOG.md` is the running record of what changed, written for the people who use the app (HR, Finance,
managers), not for developers. Each line says what people will notice and links the issue and pull request.

- **Every pull request** that changes what people see, or how hours, leave or payroll are counted, adds a line under
  **Unreleased**. Docs-only and test-only changes can skip it.
- **To ship a batch**, a pull request renames **Unreleased** to the next version and date
  (`## v0.2.0 — 15 October 2026`) and starts a new empty **Unreleased** above it. When it merges,
  `.github/workflows/release.yml` publishes that section as a GitHub Release, tagged on the main branch. The
  release lists only what's in that version.
- Versions: the middle number goes up for a batch of features, the last number for a batch of fixes only.

## Project board

The board keeps itself up to date with the project's built-in workflows (**⋯ → Workflows** on the board). Keep
these turned on:

| Workflow | What it does |
|---|---|
| **Auto-add to project** (filter `is:issue,pr is:open`) | Every new issue and pull request in this repo lands on the board, in *Backlog* |
| **Item closed** → *Done* | A closed issue moves to *Done* |
| **Pull request merged** → *Done* | A merged pull request moves to *Done*; the issues it closes follow |
| **Item reopened** → *In progress* | A reopened issue goes back on the board as work |

Moving a card to *Next* or *In progress* is the one step people do by hand: it says what's being worked on now.

## Labels

| Label | Meaning |
|---|---|
| `feature` | Something new the app should do |
| `bug` | Something that works wrongly |
| `critical` | Wrong hours, overtime, leave or payroll, or people blocked. Fix first |
| `payroll` | Touches hours, overtime, leave balances or month closing |
| `pilot-feedback` | Came from people using the pilot |
| `epic` | A goal made of several issues (its sub-issues), with a progress bar |
| `research` | A question to look into before deciding to build |
| `ux`, `accessibility`, `security`, `tech-debt` | The kind of change |
| `size: S`, `size: M`, `size: L` | About a day or two, about a week, needs splitting |

## From idea to release

| Step | Where it lives | What it looks like |
|---|---|---|
| **Idea or research** | Issue from **New issue → Research or idea** (label `research`) | The question, findings, a recommendation, and what was decided |
| **Decision** | `docs/decisions/` | Lasting rules and why (e.g. "a forgotten clock-out counts nothing"), see [decisions](decisions/README.md) |
| **Epic** | Issue labelled `epic`, with its features as **sub-issues** | A progress bar: "6 of 9 done" |
| **Feature or bug** | Issue from **Feature** or **Bug** | Why, what, and a **Done when** checklist |
| **Work** | Pull request that says `Closes #N` | Tests, walkthrough and the **Logged** check must pass |
| **Release** | `CHANGELOG.md` → GitHub **Releases** | Plain-language notes, one version number everywhere |
| **Feedback** | Issue from **Pilot feedback** | Becomes the next bug, feature or research issue |

Current epics: Phase 2 (#34, done), payroll fixes before the pilot (#35, done), pilot and go-live (#36), ways of
working (#37).

## Milestones and versions

A **milestone is a version**: it groups the issues planned for one release, shows how much of it is done, and puts it
on the board's Roadmap with its due date. The same number appears in five places that must agree (see
[decision 0004](decisions/0004-versions-and-milestones.md)): the milestone, the `CHANGELOG.md` heading,
`package.json`, the GitHub Release tag, and `/api/health` on the running site.

| Milestone | Due | What's in it |
|---|---|---|
| **v0.1 — Pilot build** | 30 September 2026 | Everything shipped so far: Phase 2 (#34), payroll fixes (#35), ways of working (#25, #31, #33). Close it once v0.1.0 is released |
| **v0.2 — Pilot** | 31 October 2026 | Made-up demo names (#29), go-live settings (#38), the pilot itself (#14), and the pilot feedback that must be fixed |
| **v1.0 — Go live** | After the pilot's go / no-go | What the pilot says must change before everyone uses it |

**Creating a milestone** (repo owner, once per version): the repo's **Issues** tab → **Milestones** → **New milestone**
→ title (e.g. `v0.2 — Pilot`), due date, and a one-line description → **Create milestone**. Then open each issue and
pick the milestone in the right-hand sidebar (or select several in the issue list → **Milestone**).

**Shipping a version** is one pull request that:
1. sets `package.json` `version` (e.g. `0.2.0`);
2. renames **Unreleased** in `CHANGELOG.md` to `## v0.2.0 — <date>` and starts a new empty **Unreleased**;
3. says `Closes` for anything it finishes.

When it merges, the Release is published; then close the milestone. The **Logged** check and the release workflow both
refuse a `package.json` that doesn't match the changelog.

Numbers: `0.MINOR.PATCH` until go-live, which is `1.0.0`. A batch of features raises MINOR, a batch of fixes only
raises PATCH.

## Checks on every pull request

| Check | What it guards |
|---|---|
| **Checks → Tests, typecheck and build** | Rules, database code and the build |
| **Checks → End-to-end in a browser** | A week at EMS, played in Chromium |
| **Logged → Linked to an issue, version consistent** | The description says `Closes #N` or `Refs #N`; `package.json` matches the changelog |

Make them required under **Settings → Branches** (#38), so nothing reaches the main branch without them.

## Where the plan lives

- The roadmap: the project board's **Roadmap** view, grouped by milestone.
- What shipped: [CHANGELOG.md](../CHANGELOG.md) and the repo's **Releases**.
- Why things work the way they do: [decisions](decisions/README.md).
- Why we chose these features: [People & Culture Next Steps](https://claude.ai/artifact/R4S3FnvyyzwD9W36hfxSq6) (competitor research, broken down into features).
- How the code is built: [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md) and [AGENTS.md](../AGENTS.md).
