# Contributing to PERM Tracker

Thanks for your interest in PERM Tracker.

## Getting started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/permtracker.git`
3. Install dependencies: `cd permtracker/v2 && pnpm install`
4. Start the dev servers (two terminals):
   - `npx convex dev` (terminal 1)
   - `pnpm dev` (terminal 2)
5. Open http://localhost:3000

## Development

- All code lives in `v2/`, so run commands from there
- TypeScript strict mode: no `any` types
- Tests first: write a failing test before the code
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`
- `v2/CLAUDE.md` is the full developer guide

## Submitting changes

1. Create a feature branch from `main`
2. Make your changes in small, focused commits
3. Make sure `pnpm check` passes
4. Open a pull request against `main`

## Code of conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before you contribute.

## Questions

Open an issue or write to the maintainers.
