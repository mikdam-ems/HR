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
5. **Someone reviews and merges.** Then it goes to the pilot site.
6. **Each shipped batch gets a release** (the repo's **Releases** page) with plain-language notes on what changed.

## Labels

| Label | Meaning |
|---|---|
| `feature` | Something new the app should do |
| `bug` | Something that works wrongly |
| `critical` | Wrong hours, overtime, leave or payroll, or people blocked. Fix first |
| `payroll` | Touches hours, overtime, leave balances or month closing |
| `pilot-feedback` | Came from people using the pilot |
| `ux`, `accessibility`, `security`, `tech-debt` | The kind of change |
| `size: S`, `size: M`, `size: L` | About a day or two, about a week, needs splitting |

## Milestones

Group issues by when they should ship, for example **Pilot**, **Before Ramadan 2027** or **Phase 2**. Each milestone shows
how much of it is done.

## Where the plan lives

- The roadmap: the project board's **Roadmap** view.
- Why we chose these features: [People & Culture Next Steps](https://claude.ai/artifact/R4S3FnvyyzwD9W36hfxSq6) (competitor research, broken down into features).
- How the code is built: [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md) and [AGENTS.md](../AGENTS.md).
