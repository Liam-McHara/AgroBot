# ADR-0008: Keep 1.0 under `legacy/` until 2.0 ships, then delete

- Status: Accepted
- Date: 2026-09-17

## Context
2.0 is a rewrite in the same repository. The 1.0 code is small and its behaviour is worth
consulting while rebuilding (message wording, edge cases we hit), but it must not be extended
and must not get in the way of the new workspace at the root.

## Decision
Move the whole 1.0 tree to **`legacy/`** with a README explaining its status. The root becomes
the 2.0 pnpm workspace. `legacy/` is excluded from lint, typecheck, tests and CI. When 2.0 is
in production, delete the folder in one commit and tag the last commit containing it
(`v1-legacy`).

## Consequences
- Old code stays one click away during the rebuild; no branch archaeology.
- No code is shared between `legacy/` and the new apps.
- One follow-up task (deletion) in the roadmap's last milestone.

## Alternatives considered
- **Delete now, rely on git history.** Cleaner, but slower to consult during the rebuild.
- **Keep at root, build in a subfolder.** Confusing entry point for the whole life of the repo.
