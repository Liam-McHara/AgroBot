# AgroBot 2.0 documentation

This folder is the **source of truth** for AgroBot 2.0. Code implements these documents;
when code and documents disagree, one of them is a bug and the fix lands in the same PR.

## Read in this order

1. [legacy-review.md](legacy-review.md) — what 1.0 did, what broke, what we learned. 5 minutes.
2. [prd.md](prd.md) — product requirements: vision, principles, user stories with acceptance
   criteria, notifications, admin area, non-functional requirements, open questions.
3. [architecture.md](architecture.md) — how it is built: layout, libraries, auth, data model,
   state machines, realtime, outbox, jobs, sync, API, Mini App, config, dev loop, CI, tests.
4. [adr/](adr/README.md) — why each big decision was taken and what was rejected.
5. [roadmap.md](roadmap.md) — the plan: milestones M0–M6 with tasks and definitions of done.

## The spec-driven workflow

```
   idea / feedback
        │
        ▼
   prd.md  ──── user story + acceptance criteria (what, for whom, why)
        │
        ▼
   architecture.md ── data, API, state machine changes (how)
        │            └─ adr/00NN-*.md when an alternative was seriously considered
        ▼
   roadmap.md ──── tasks under the right milestone, definition of done
        │
        ▼
   code + tests ── PR references the PRD user story and roadmap task; checks the box
```

Rules:
- **No feature without a user story.** If it is not in the PRD, add it there first (a PR that
  only touches docs is fine and encouraged).
- **No silent deviation.** If implementing reveals the spec is wrong, change the spec in the
  same PR and say so in the PR description.
- **ADRs are append-only.** To change a decision, write a new ADR that supersedes the old one.
- **Definitions of done are the acceptance test.** A milestone is not finished because its
  tasks are checked; it is finished when its definition of done holds.
- **Open questions live in [prd.md §13](prd.md#13-open-questions)**
  with a default. Resolving one means editing the relevant section and deleting the row.

## Starting a milestone in a fresh Claude Code session

Paste something like this as the first message (adjust the milestone):

> We are building AgroBot 2.0 in this repository following the spec in `docs/`.
> Read `CLAUDE.md`, `docs/README.md`, `docs/prd.md`, `docs/architecture.md` and the ADRs,
> then read `docs/roadmap.md` and implement **M0 — Foundation** completely.
> Work on a branch named `m0-foundation`, commit in small steps, keep `pnpm lint typecheck test build`
> green, update the roadmap check boxes and CLAUDE.md commands as you go, and stop when the
> definition of done holds. If the spec is ambiguous or wrong, fix the spec in the same PR and
> tell me what you changed.

For M1 onwards add: "M0 is merged on `main`; build on it." The session should re-read the
spec sections the milestone lists under **Spec.** before writing code.

## Conventions for these documents

- Markdown, wrapped at ~100 columns, tables for anything enumerable.
- User stories are `US-<epic>.<n>`, notifications `N<n>`, ADRs `ADR-00NN`, open questions `Q<n>`;
  code comments and PRs reference them by these ids.
- English in documents and code; Catalan and Spanish only inside the message catalogues.
- Dates in ISO 8601. Money in EUR cents in code, formatted per locale in the UI.
