# PERM Tracker

Free PERM case status and DOL data for people waiting on a green card, and case tracking for the attorneys who file them.

**Live at [permtracker.app](https://permtracker.app)**

[![Tests](https://github.com/adam-j-ali/permtracker/actions/workflows/test.yml/badge.svg)](https://github.com/adam-j-ali/permtracker/actions/workflows/test.yml)

![The PERM Tracker homepage](docs/images/homepage-2026-10.jpg)

## For people waiting on a case

- Case status for PERM, wage requests, H-1B LCAs, H-2A, H-2B and CW-1
- Search by employer, law firm, state, job or city
- DOL's queue and processing times
- Visa bulletin history
- USCIS processing times, I-140 and I-485 figures, and approvals by receipt block
- Each consulate's interview line and the visas it issued
- Green card timelines people reported, each person counted once
- An estimate scorecard: how close our dates land
- Free calculators
- Email alerts, no account needed
- A free API and MCP server ([permtracker.app/developers](https://permtracker.app/developers))
- Badges and embeds for your own site ([permtracker.app/badges](https://permtracker.app/badges))

## For attorneys

- Case tracking with every PERM deadline worked out
- RFI and RFE tracking
- Reminders by email, browser push and in the app
- Google Calendar sync
- An AI assistant for your cases

Every figure comes from the agency that publishes it. Sources: [permtracker.app/methodology](https://permtracker.app/methodology).

## Run it locally

You need Node 24 and pnpm.

```bash
cd v2
cp .env.example .env.local    # then fill it in
pnpm install
npx convex dev                # terminal 1
pnpm dev                      # terminal 2
```

Then open http://localhost:3000.

Before you push:

```bash
pnpm check
```

## More

- [v2/CLAUDE.md](v2/CLAUDE.md): the developer guide
- [perm_flow.md](perm_flow.md): how the PERM process works
- [v2/TEST_README.md](v2/TEST_README.md): tests
- [v2/docs/API.md](v2/docs/API.md): the Convex API
- [v2/docs/CRYPTO.md](v2/docs/CRYPTO.md): keys, tokens and encryption

## License

All rights reserved. See [LICENSE](LICENSE). The source is published for reference only.
