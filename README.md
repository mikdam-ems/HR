# EMS People & Culture

One internal place for EMS employees to log time, request leave and see the org chart.
Each person's days off, work week and overtime follow the client they're assigned to, and the system works that out for them.

- **Plan (product):** [EMS People & Culture — Plan v0.1](https://claude.ai/code/artifact/2644cbbc-032f-4bd5-9c32-532e915d4536)
- **Wireframes:** [People & Culture Wireframes](https://claude.ai/artifact/5aTvRyU8yfekwc93seUufT)
- **Technical design:** [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)

## Status

Stage 2 of Phase 1 started: the **rules engine** (`src/domain/`) is in place with tests.
No UI, database or sign-in yet — see the stages in the technical design.

## Run it

```bash
npm install
npm test          # rules engine tests
npm run typecheck
```
