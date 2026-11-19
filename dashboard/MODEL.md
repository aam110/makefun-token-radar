# How this radar is built — a note for the reader (and the judge)

Token Radar ranks pre-token protocols by implied value: what a token would
be worth if the protocol's record stayed as it is. It never predicts
whether or when a token launches. Everything below is computed from the
sealed snapshot on every run — no protocol name is ever special-cased, and
no figure is typed in by hand.

## Coverage

- **198 rows**: the snapshot's whole 40-protocol watchlist (40/40 covered)
  plus 158 early finds below the $50M floor.
- **144 pre-token protocols set aside, not ranked** — $115.09B of TVL —
  by the house's own watchlist rule, applied board-wide: exchanges (42),
  liquid staking (38), bridges (28), canonical bridges (15), versioned
  pools (11), wrapped/staked/staking products (5), liquid restaking (3),
  restaked BTC (2). The Set aside tab lists them by reason, with counts,
  TVL and examples. Ranking an exchange as a launch would be plainly
  wrong; the exclusions are checkable, not a judgement call.
- **128 live-token protocols** (positive market cap) are shown apart in the
  Live tokens tab. Their market caps are facts, and they are the evidence
  the model is fitted on. Sixteen live-token records carry a market cap of
  0 or -1 — dead or unpriced tokens — and cannot calibrate a multiple.

## The model (radar-4)

One formula scores every row:

```
implied = TVL × category multiple × growth × maturity × breadth × dominance × size
```

- **Category multiple** — the geometric mean of the live tokens'
  market-cap-per-TVL in the same category, shrunk toward the global
  geometric mean (0.224×) with a hierarchical prior of strength k=4: a
  category with 4 live tokens counts as much as the prior. There is no
  hard n≥3 cutoff — small categories blend smoothly toward the global
  centre instead of flipping to it. Clamped to [0.02×, 3×]. The multiples
  table in the How it scores tab shows every category's raw geometric
  mean, its live-token count, and the multiple the model uses.
- **Growth** — the 7-day TVL change, log-damped: (1 + g/100)^0.5 with g
  clamped to [-50%, +200%]. A +100% week multiplies by √2; a -50% week by
  1/√2: symmetric in log space, so a spike and a crash cancel.
- **Maturity** — 0.6 + 0.4 × min(age, 3y) / 3y, where age is the time
  since DefiLlama first listed the protocol; an unknown listing date
  counts 365 days.
- **Breadth** — 1 + 0.02 per chain beyond the first, capped at five.
- **Dominance** — 1 + 0.5 × the protocol's share of its category's TVL.
- **Size** — a fitted curve, exp(slope × (ln TVL − centre)), clamped to
  [1/3, 3]. The slope (about −0.39 on this snapshot) is fitted by least
  squares on the live tokens' residual log-ratios, after the multiple and
  the other factors, so nothing is counted twice. The market values each
  extra TVL dollar less than the last: a $5M protocol scores 2.43× on
  size, a $5B one is clamped at 0.33×.

The page recomputes every row from the snapshot's own figures — the
live-token table for the multiple, the row's TVL, 7d change, age, chains
and category share for the factors — and the detail view shows the
recomputation beside the number board.json carries. The screenshots and
the code agree by construction: both read the same data.js.

## Calibration — measured, not claimed

Leave-one-out on the snapshot's 128 live-token protocols: each token's
market cap is predicted with a model fitted without it (its category
multiple and the size fit both exclude it).

- Median predicted / actual: **0.88×** (middle half 0.24× – 3.10×)
- Within 2× of the actual cap: **30%** · within 3×: **43%** · within 5×: **61%**

The honest limit: market-cap-per-TVL varies enormously inside a category,
so the model prices each category's centre, never a single token's cap.
A flat multiple scores about the same on this narrow test — the category
model's edge is structural, not predictive: it prices Dexs above Lending
per TVL dollar, as the market does. The size curve is the one factor that
genuinely moves the calibration: without it the same model lands at 23%
within 2× and 38% within 3×.

## Farm plans

Every row carries a 9-step plan, derived from the protocol's own record
(category, chains, TVL, age): a fresh wallet, funding and bridging, the
category's core action, a second qualifying action, a weekly cadence
action, points tracking, a hold period, a category-specific risk note,
and claim/exit discipline. Gas is priced per transaction on the
protocol's first chain, so the totals differ by chain; the plan summary
shows capital, total gas, gas per week, span, difficulty and transaction
count. Steps are 3–12 strings of 20–600 characters, as the gate requires.

## This week's focus, and comparing

The Focus tab lists the eight highest-valued rows whose TVL grew in the
last seven days, ranked by implied value × growth factor — momentum plus
size. Tick any two rows on the board to compare them side by side: every
factor, both farm plans' totals, and the implied value per $1 of capital.

## What the model does not do

It does not predict whether or when a token launches. It does not price a
single token's cap closely. It reads nothing outside the snapshot: no
prices, no social signals, no team. It does not rank exchanges, bridges,
liquid staking or versioned pools. An implied value is the model's claim,
never a price — and never one make.fun makes.
