# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aam110/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aam110/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — a dashboard that finds the protocols whose token does not exist yet, ranks them by
what a launch would be worth, and shows how to farm each one. Built for make.fun's
“Build the best token launch radar” bounty ($1,325 in USDC).

The program reads a sealed DefiLlama snapshot of 758 protocols (as of 2026-11-14), scores every
rankable pre-token protocol, and writes a ranked board of 198 rows covering the snapshot's whole
40-protocol watchlist, plus a static dashboard, three screenshots and a dossier.

## The model (radar-2)

Implied value follows only from the snapshot's own figures — no protocol name is special-cased:

```
implied = TVL × category multiple × growth × maturity × breadth × dominance
```

- **Category multiple** — the median market-cap-per-TVL of the live-token protocols in the same
  category, measured from the snapshot and shrunk toward the global median. A category needs at
  least 3 live tokens to set its own multiple; with fewer, the global median applies.
- **Growth** — the 7-day TVL change, clamped to −50%…+100% at half weight.
- **Maturity** — how long the protocol has run with no token, capped at three years.
- **Breadth** — a small premium per extra chain, capped at five.
- **Dominance** — a premium for the protocol's share of its category's total TVL.

Wrapped, staked and bridged products of tokens that already trade (WBTC, staked ETH, bridges),
exchanges and versioned pools are set aside, not ranked: they are not launches waiting to happen.
Every row carries a 7-step farm plan with a cost and a time for each step.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node.js 22.18 or later, standard library only — nothing to install. The run is fully
deterministic: no network, no clock, no randomness; two runs write the same bytes. It writes
`out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`.

To view the dashboard, open `out/dashboard/index.html` in a browser (it reads `out/data.js`,
no network). Deep links: `#p/<slug>` opens a protocol's detail view, `#c/<category>` filters
by category, `#w` shows the watchlist only.

## Layout

- `main.ts` — the entrypoint the grader runs
- `lib/model.ts` — the value model, the farm plans and the board builder
- `vendor/makefun-board.ts` — make.fun's dossier library, from the competition kit
- `dashboard/` — the static page (index.html, app.css, app.js)
- `screenshots/` — the board, a detail view and a filtered view

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
