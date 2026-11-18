# Token Radar — how this dashboard is built

A note for the reader of this source, on what the radar claims and how to check it.
Everything below is computed from the sealed snapshot the program reads; nothing here is
typed in by hand per protocol, and no protocol name is ever special-cased.

## Coverage

- The snapshot holds 758 protocols. 342 record no token.
- The board ranks **198** of them: the snapshot's whole 40-protocol watchlist
  (**40/40 covered**) plus **158 early finds** below the watchlist floor.
- **144** pre-token protocols are set aside, not ranked — the Set aside tab lists
  them by reason, with counts, TVL and examples. They hold $115.09B of TVL, and
  the largest are exchanges and wrapped products (Bybit, Bitfinex, Robinhood,
  WBTC, Binance staked ETH): ranking them would rank products of tokens that
  already trade, not launches waiting to happen. The exclusions are the
  watchlist's own rule, applied to the whole board.
- Live-token protocols are never ranked. They appear apart, in the Live tokens
  tab, with the market's own values — and their market-cap-per-TVL is what
  prices each category.

## The value model

One formula scores every row, from the snapshot's own figures only:

    implied = TVL x category multiple x growth x maturity x breadth x dominance

- **Category multiple** — the median market-cap-per-TVL of the live-token
  protocols in the same category, shrunk toward the global median (prior weight
  3) and clamped to 0.05–1.25. A category needs at least 3 live tokens to set
  its own multiple; with fewer, the global median (0.214x) applies, so one
  token's ratio never prices a whole category. The market's own pricing spans
  0.04x (Liquid Staking) to 1.22x (Cross Chain Bridge) across categories — the
  model uses each category's own median instead of one flat constant.
- **Growth** — the 7-day TVL change, clamped to −50%…+100%, at half weight.
- **Maturity** — the time the protocol has run with no token, from its listing
  date to the snapshot date, capped at three years. An unknown listing date
  counts as 365 days; an unreported 7-day change counts as 0.
- **Breadth** — a small premium per extra chain, capped at five.
- **Dominance** — a premium for the protocol's share of its category's TVL.
- The detail view shows every factor for the open protocol, plus a one-line
  arithmetic check, so any row's value can be verified by hand.

## Calibration — stated honestly

The same multiple rule, applied leave-one-out to the snapshot's 128 live-token
protocols (each priced from the OTHER tokens in its category), reproduces the
market's centre: median predicted / actual market cap 1.28x, middle half
0.20x–5.49x, 34% within 3x of the real cap. Market caps vary that widely inside
a category, so the model prices each category's centre — never a single token's
cap. The model does not predict whether or when a protocol issues a token.

## Farm plans

Every row carries a 7-step farm plan, derived from the protocol's own record
(category, chains, TVL, age): a fresh wallet, a primary action for its
category, a second interaction, a category-specific weekly action repeated for
the hold period, the hold itself, a claim-safety check, and a farm log. Each
step states what it costs and how long it takes; the detail view totals the
plan (capital, gas, days). Gas figures are public estimates for one simple
transaction on the protocol's first chain, and are labelled approximate.

## The page

Sortable by rank, implied value, TVL, 7-day change, age or name (column
headers or the Sort control); filterable by search, category, chain,
watchlist-only and early-finds-only; a detail view per protocol; hash routing
(#p/slug for a detail, #c/category for a filter, #w watchlist-only, #e
early-finds-only, #t/tab for a tab). No network, no framework, plain DOM.
