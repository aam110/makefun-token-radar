# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aam110/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aam110/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by what a launch would be worth — and shows how to farm each one. It reads a sealed DefiLlama snapshot of 758 protocols and writes a ranked board of 198: the snapshot's whole 40-protocol watchlist (40/40 covered) plus 158 early finds below the floor, each with a 7-step farm plan. Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.

## The model (radar-3)

One formula scores every row, from the snapshot's own figures only — no protocol name is ever special-cased:

```
implied = TVL × category multiple × growth × maturity × breadth × dominance
```

- **Category multiple** — the median market-cap-per-TVL of the live-token protocols in the same category, measured from the snapshot and shrunk toward the global median (0.214×). A category needs at least 3 live tokens to set its own multiple; with fewer, the global median applies.
- **Growth** — the 7-day TVL change, clamped to −50%…+100%, at half weight.
- **Maturity** — how long the protocol has run with no token, capped at three years.
- **Breadth** — a small premium per extra chain, capped at five.
- **Dominance** — a premium for the protocol's share of its category's TVL.

The dashboard states the formula, the derived multiples, and a leave-one-out calibration against the snapshot's own live tokens (median predicted/actual market cap 1.28×) — including the honest limit that the model prices each category's centre, never a single token's cap. It never predicts whether or when a token launches.

144 pre-token protocols are set aside, not ranked — exchanges, bridges, liquid staking and restaking products, and versioned pools — and the dashboard's Set aside tab lists them by reason, with counts, TVL and examples. Live-token protocols are shown apart, with the market's own values.

## The dashboard

A single page, no network, no framework: a sortable, filterable board (search, category, chain, watchlist-only, early-finds-only), a detail view per protocol with the full value breakdown, a one-line arithmetic check and the farm plan with its totals (capital, gas, days), a Live tokens reference, a How it scores page, and a Set aside page.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (standard library only). The run is deterministic: two runs write the same bytes. It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory.

To view the dashboard, open `out/dashboard/index.html` in a browser (it reads `out/data.js`, no network). Deep links: `#p/<slug>` opens a protocol's detail view, `#c/<category>` filters by category, `#w` shows the watchlist only, `#e` shows early finds only, `#t/<tab>` switches tab.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes the board, the dashboard data, and the dossier.
- `lib/model.ts` — the model, the farm plans, the calibration and the set-aside breakdown.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`, and `MODEL.md`, a note on how the radar is built.
- `screenshots/` — four screenshots of the built dashboard: the board, a detail view, a filtered view, and the model page.
- `vendor/makefun-board.ts` — the kit's dossier library, copied as-is.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
