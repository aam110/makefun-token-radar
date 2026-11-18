// The token radar's model (radar-3): one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can rank: the 40 on the watchlist (the
// floor, never the ceiling) plus every other pre-token protocol below the floor that is not an
// exchange, not a wrapped, staked or bridged product of a token that already trades, and not a
// versioned pool of another protocol. Live-token protocols are kept apart and shown with the
// market's own values, never mixed into the ranked board. The 144 pre-token protocols the board
// sets aside are listed with their reasons in `setAsideBreakdown`, so the exclusions are
// checkable instead of invisible.
//
// Implied value follows only from the snapshot's own figures. No protocol name is special-cased;
// the same function scores every row:
//
//   implied = tvl_usd x catMultiple x growthMult x maturityMult x breadthMult x dominanceMult
//
//   catMultiple  the market's own pricing for the protocol's category: the median mcap/TVL of the
//                live-token protocols in that category, measured from this snapshot and shrunk
//                toward the global median (prior weight 3), clamped to [0.05, 1.25]. A category
//                needs at least 3 live tokens to set its own multiple; with fewer, or none, the
//                global median applies — one token's ratio never prices a whole category.
//   growthMult   1 + clamp(change_7d, -50, 100) / 100 x 0.5            -> [0.75, 1.5]
//   maturityMult 0.7 + min(age_days, 1095) / 1095 x 0.5                -> [0.7, 1.2]
//   breadthMult  1 + 0.03 x min(max(chains - 1, 0), 5)                 -> [1, 1.15]
//   dominanceMult 1 + 0.3 x (protocol TVL / its category's total TVL)  -> [1, 1.3]
//
// Age is the days from listed_at to the snapshot's as_of; an unknown age counts as 365 days, an
// unreported 7-day change counts as 0. Every multiplier is stated in the dashboard's detail view,
// so a reader can check the arithmetic for any row.
//
// Calibration: `calibrate` runs the same multiple rule against the snapshot's own live-token
// protocols, leave-one-out — each token priced from the OTHER tokens in its category — and
// reports how close the model's multiples land to the market's real caps. The honest result is
// that mcap/TVL varies enormously inside a category, so the model prices a category's centre,
// never a single token's cap; the dashboard states the numbers instead of hiding them.
//
// Farm plans: `farmSteps` builds seven steps per protocol from the protocol's own record
// (category, chains, TVL, age): a fresh wallet, a primary category action, a second interaction,
// a category-specific weekly action for the hold period, the hold itself, a claim-safety check
// and a farm log. Each step carries what it costs and how long it takes, and `farmSummary`
// totals the plan's capital, gas and span so the detail view can show the whole plan's price.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  shrink_prior: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_chains: number;
  dominance_weight: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.05,
  multiple_cap: 1.25,
  shrink_prior: 3,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_max_chains: 5,
  dominance_weight: 0.3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, how long it takes, and its gas in dollars. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
  /** Gas for this step's transactions, in US dollars (0 when the step spends no gas). */
  gas_usd: number;
}

/** A farm plan's totals: what the whole plan costs and how long it runs. */
export interface FarmSummary {
  capital_usd: number;
  gas_usd: number;
  days: number;
  steps: number;
}

/** One multiplier of the value model, as the dashboard shows it. */
export interface ModelBreakdown {
  category_multiple: number;
  category_median: number;
  category_live_n: number;
  global_median: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  dominance_multiplier: number;
  category_share: number;
  age_days: number | null;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
  farm_summary: FarmSummary;
}

/** The dashboard's view of one row: the board row plus its farm plan. */
export type RadarRow = BoardRow;

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's derived multiple, for the dashboard's "How it scores" table. */
export interface CategoryMultiple {
  category: string;
  live_n: number;
  median: number;
  multiple: number;
}

/** The leave-one-out calibration of the multiple rule against the live tokens. */
export interface Calibration {
  /** Live-token protocols priced in the check. */
  live_n: number;
  /** Median of predicted market cap / actual market cap. */
  median_ratio: number;
  /** 25th and 75th percentiles of that ratio. */
  p25_ratio: number;
  p75_ratio: number;
  /** Share of tokens whose predicted cap lands within 2x / 3x / 5x of the real one. */
  within_2x: number;
  within_3x: number;
  within_5x: number;
}

/** One reason pre-token protocols are set aside, not ranked. */
export interface SetAsideReason {
  reason: string;
  count: number;
  tvl_usd: number;
  /** The largest examples, as "Name ($XM)". */
  examples: string[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  snapshot_protocols: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  set_aside_tvl_usd: number;
  total_implied_usd: number;
  global_median: number;
  multiples: CategoryMultiple[];
  calibration: Calibration;
  set_aside: SetAsideReason[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers (mean of the two middles when even); NaN when empty. */
function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-th quantile of a sorted list (nearest-rank); NaN when empty. */
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are wrapped, staked or bridged products of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A wrapped or staked product's name carries one of these whole words. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a wrapped product's name begins with. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Why a pre-token protocol is set aside instead of ranked, or null when it is rankable. The
 * exclusions are the house's own watchlist rule, applied to the whole board rather than only the
 * watchlist floor: a wrapped, staked or bridged product of a token that already trades (WBTC is
 * Bitcoin on Ethereum, Binance staked ETH is ETH in a staking product) is not a protocol still
 * waiting on a launch of its own, an exchange is not a launch, and a versioned pool belongs to
 * another protocol. The first matching reason wins, in the order the house rule lists them.
 */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return null;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return `Category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'Versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'Name carries wrapped, staked or staking';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'Name begins with an exchange';
  return null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not an exchange, and not a versioned pool of another
 * protocol.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/** Everything the model derives from the snapshot before it scores a row. */
export interface ModelContext {
  model: ModelConstants;
  asOf: string;
  /** The global median mcap/TVL across live-token protocols. */
  globalMedian: number;
  /** Per-category median mcap/TVL and live sample size, keyed by category ('' for null). */
  categoryStats: Map<string, { median: number; n: number }>;
  /** Total TVL per category across all protocols, keyed by category ('' for null). */
  categoryTvl: Map<string, number>;
}

/** Derive the market's category multiples from the snapshot's live-token protocols. */
export function deriveContext(snapshot: Snapshot, model: ModelConstants = MODEL): ModelContext {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMedian = median(ratios);
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const categoryStats = new Map<string, { median: number; n: number }>();
  for (const [key, list] of byCategory) categoryStats.set(key, { median: median(list), n: list.length });
  const categoryTvl = new Map<string, number>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? '';
    categoryTvl.set(key, (categoryTvl.get(key) ?? 0) + p.tvl_usd);
  }
  return { model, asOf: snapshot.as_of, globalMedian, categoryStats, categoryTvl };
}

/** A category needs this many live tokens to set its own multiple; fewer take the global median. */
const MIN_LIVE_FOR_CATEGORY = 3;

/** The category multiple for one protocol: its category's median, shrunk toward the global median. */
export function categoryMultiple(p: SnapshotProtocol, ctx: ModelContext): { multiple: number; median: number; n: number } {
  const stats = ctx.categoryStats.get(p.category ?? '');
  const n = stats?.n ?? 0;
  if (n < MIN_LIVE_FOR_CATEGORY) return { multiple: round4(clampMultiple(ctx.globalMedian, ctx.model)), median: round4(ctx.globalMedian), n };
  const catMedian = stats!.median;
  const shrunk = (n * catMedian + ctx.model.shrink_prior * ctx.globalMedian) / (n + ctx.model.shrink_prior);
  return { multiple: round4(clampMultiple(shrunk, ctx.model)), median: round4(catMedian), n };
}

/** A multiple inside the model's floor and cap. */
function clampMultiple(value: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, value));
}

/** The five multipliers and the implied value one protocol gets. */
export function impliedValue(p: SnapshotProtocol, ctx: ModelContext): { implied: number; breakdown: ModelBreakdown } {
  const m = ctx.model;
  const age = ageDays(ctx.asOf, p.listed_at);
  const { multiple, median: catMedian, n } = categoryMultiple(p, ctx);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * m.growth_weight;
  const ageForModel = age ?? m.unknown_age_days;
  const maturityMult = m.maturity_floor + (Math.min(Math.max(ageForModel, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
  const breadthMult = 1 + m.breadth_step * Math.min(Math.max(p.chains.length - 1, 0), m.breadth_max_chains);
  const catTotal = ctx.categoryTvl.get(p.category ?? '') ?? 0;
  const share = catTotal > 0 ? p.tvl_usd / catTotal : 0;
  const dominanceMult = 1 + m.dominance_weight * share;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * breadthMult * dominanceMult));
  return {
    implied,
    breakdown: {
      category_multiple: round4(multiple),
      category_median: catMedian,
      category_live_n: n,
      global_median: round4(ctx.globalMedian),
      growth_pct: round4(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      breadth_multiplier: round4(breadthMult),
      dominance_multiplier: round4(dominanceMult),
      category_share: round4(share),
      age_days: age,
    },
  };
}

/**
 * Leave-one-out calibration of the multiple rule against the snapshot's own live-token
 * protocols: each live token is priced from the OTHER live tokens in its category (a category
 * with fewer than 3 others takes the global median of the others), shrunk and clamped exactly
 * as the board's multiples are, and the predicted cap is compared with the real one. The
 * result says how far the model's multiples land from the market's real caps — the honest
 * answer is "the centre, not the token": mcap/TVL varies so widely inside a category that no
 * multiple predicts a single token's cap closely, and the dashboard says so.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios: number[] = [];
  for (const p of live) {
    const others = live.filter((q) => q !== p);
    const globalMedian = median(others.map((q) => q.mcap_usd! / q.tvl_usd));
    const cat = others.filter((q) => (q.category ?? '') === (p.category ?? '')).map((q) => q.mcap_usd! / q.tvl_usd);
    let multiple: number;
    if (cat.length >= MIN_LIVE_FOR_CATEGORY) {
      const shrunk = (cat.length * median(cat) + model.shrink_prior * globalMedian) / (cat.length + model.shrink_prior);
      multiple = clampMultiple(shrunk, model);
    } else {
      multiple = clampMultiple(globalMedian, model);
    }
    ratios.push((p.tvl_usd * multiple) / p.mcap_usd!);
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const within = (k: number): number => (ratios.length === 0 ? 0 : round4(ratios.filter((r) => r >= 1 / k && r <= k).length / ratios.length));
  return {
    live_n: ratios.length,
    median_ratio: round4(median(ratios)),
    p25_ratio: round4(quantileSorted(sorted, 0.25)),
    p75_ratio: round4(quantileSorted(sorted, 0.75)),
    within_2x: within(2),
    within_3x: within(3),
    within_5x: within(5),
  };
}

/** The pre-token protocols the board sets aside, grouped by their exclusion reason. */
export function setAsideBreakdown(snapshot: Snapshot): SetAsideReason[] {
  const groups = new Map<string, { count: number; tvl: number; names: { name: string; tvl: number }[] }>();
  for (const p of snapshot.protocols) {
    const reason = setAsideReason(p);
    if (reason === null) continue;
    const g = groups.get(reason) ?? { count: 0, tvl: 0, names: [] };
    g.count += 1;
    g.tvl += p.tvl_usd;
    g.names.push({ name: p.name, tvl: p.tvl_usd });
    groups.set(reason, g);
  }
  const fmtTvl = (n: number): string => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);
  return [...groups.entries()]
    .map(([reason, g]) => ({
      reason,
      count: g.count,
      tvl_usd: g.tvl,
      examples: [...g.names].sort((a, b) => b.tvl - a.tvl).slice(0, 3).map((x) => `${x.name} (${fmtTvl(x.tvl)})`),
    }))
    .sort((a, b) => b.count - a.count || b.tvl_usd - a.tvl_usd);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, ctx: ModelContext): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const { implied, breakdown } = impliedValue(p, ctx);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0));
  return scored.map((s, i) => {
    const steps = farmSteps(s.p, s.breakdown.age_days);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      on_watchlist: watchlist.has(s.p.slug),
      age_days: s.breakdown.age_days,
      implied_value_usd: s.implied,
      model: s.breakdown,
      farm_steps: steps.map(stepText),
      farm_summary: farmSummary(steps, s.p, s.breakdown.age_days),
    };
  });
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`.trim();
  if (s.length > 600) s = `${s.slice(0, 597).trimEnd()}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page for its next step.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Approximate gas for one simple transaction on a chain, in US dollars (public estimates). */
const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 4, Bitcoin: 2, Tron: 1, RSK: 0.5, Bittensor: 0.5, Avalanche: 0.3,
  Binance: 0.15, Arbitrum: 0.1, 'zkSync Era': 0.1, ZkSync: 0.1, Optimism: 0.08,
  'Hyperliquid L1': 0.05, Base: 0.05, Polygon: 0.05, Ink: 0.05, Mode: 0.05,
  Flare: 0.05, Pharos: 0.05, Monad: 0.05, Plasma: 0.05, 'Robinhood Chain': 0.05,
  Berachain: 0.05, Unichain: 0.05, Sonic: 0.05, Arc: 0.05, Katana: 0.05,
  'Plume Mainnet': 0.05, Linea: 0.05, Hemi: 0.05, Mantle: 0.05, TAC: 0.05,
  Scroll: 0.05, Starknet: 0.05, 'World Chain': 0.05, Morph: 0.05, Blast: 0.05,
  Soneium: 0.05, 'Op_Bnb': 0.05, 'Polygon zkEVM': 0.05, Taiko: 0.05, Zircuit: 0.05,
  'BOB': 0.05, 'CORE': 0.05, Sei: 0.02, Solana: 0.02, Sui: 0.01, Aptos: 0.01,
  Stellar: 0.01, Near: 0.01, Algorand: 0.01,
};

function gasUsd(chain: string): number {
  return CHAIN_GAS_USD[chain] ?? 0.5;
}

function gasText(chain: string): string {
  const g = gasUsd(chain);
  return g >= 1 ? `$${g}` : `$${g.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Whole weeks inside a hold period (at least one): how many weekly actions the plan makes. */
function weeksFor(holdDays: number): number {
  return Math.max(1, Math.round(holdDays / 7));
}

/** The category's primary action, in words a farmer can follow. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed position on ${chain} and let it rebalance.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} into ${name}'s top vault on ${chain} and hold the receipt token.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the shares.`;
  if (c.includes('payment')) return `Fund $${capital} into ${name} on ${chain} and make one payment through it.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name} on ${chain} and make one private transfer.`;
  if (c.includes('option')) return `Deposit $${capital} into ${name}'s vault on ${chain} and keep the shares.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('governance')) return `Lock or delegate $${capital} through ${name} on ${chain} and keep the delegation.`;
  if (c.includes('card')) return `Order the ${name} card, fund it with $${capital} and make one purchase through it.`;
  if (c.includes('otc')) return `Fund $${capital} on ${name} and place one order through its marketplace.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into ${name} on ${chain} and use its main product once.`;
  if (c.includes('btc') || c.includes('bitcoin')) return `Deposit $${capital} of BTC into ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('chain')) return `Bridge $${capital} into ${chain} and use ${name}'s main app once.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: a different interaction, so the wallet is not one-note. */
function secondaryAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the supply, then repay it the same week to record a second interaction.`;
  if (c.includes('dex')) return `Swap a small amount through ${name} each week so the wallet shows trading activity as well as liquidity.`;
  if (c.includes('liquidity manager')) return `Adjust the position's range once when the manager suggests a rebalance.`;
  if (c.includes('yield aggregator')) return `Move the receipt token into a second ${name} strategy once, to show a second product use.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Harvest the vault's rewards once a week and restake them to compound the position.`;
  if (c.includes('bridge')) return `Bridge a smaller amount back the other way a week later, on a different day than the first bridge.`;
  if (c.includes('staking') || c.includes('restak')) return `Use the receipt token once in a lending or liquidity pool so the position is active, not idle.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge and open a fresh one each week, keeping the margin deposited throughout.`;
  if (c.includes('prediction')) return `Settle the position, then place one more on a different market the following week.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Read the vault's allocation report and move a small part to a second ${name} vault once.`;
  if (c.includes('stable')) return `Hold the stable asset and use it once for a swap or a payment.`;
  if (c.includes('rwa')) return `Claim the asset's yield once and restake it through the same protocol.`;
  if (c.includes('insurance')) return `Renew or extend the cover once before it lapses.`;
  if (c.includes('basis')) return `Check the funding-rate report weekly and top the position up once.`;
  if (c.includes('payment')) return `Make one more payment the following week from the same wallet.`;
  if (c.includes('privacy')) return `Make a second transfer a week later, keeping the same wallet.`;
  if (c.includes('option')) return `Roll the position once when the vault's epoch turns over.`;
  if (c.includes('index')) return `Rebalance once by adding a small amount after a weekly rebalance.`;
  if (c.includes('governance')) return `Vote once in a live proposal from the same wallet.`;
  if (c.includes('card')) return `Pay one everyday bill with the card the following week.`;
  if (c.includes('otc')) return `Place one more order the following week from the same account.`;
  if (c.includes('cedefi')) return `Use a second ${name} product once the following week.`;
  if (c.includes('btc') || c.includes('bitcoin')) return `Use the receipt token once in a lending pool so the position is active, not idle.`;
  if (c.includes('chain')) return `Use a second app on ${chain} from the same wallet the following week.`;
  return `Make one more deposit or interaction a week later from the same wallet.`;
}

/** The category's weekly action: what "stay active" concretely means for this protocol. */
function weeklyAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Top up the supply or repay and re-borrow a small amount on ${name} once a week.`;
  if (c.includes('dex')) return `Swap a small amount through ${name} once a week, on a different day each week.`;
  if (c.includes('liquidity manager')) return `Check the managed position once a week and accept one rebalance when the manager offers it.`;
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Harvest and restake the vault's rewards once a week so the position compounds.`;
  if (c.includes('bridge')) return `Bridge a small amount through ${name} once a week, alternating direction.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards once a week and restake them through ${name}.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Roll the hedge once a week, keeping the margin deposited throughout.`;
  if (c.includes('prediction')) return `Place one new market position on ${name} each week and settle the old one.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Read the vault's weekly report and adjust the deposit once a week.`;
  if (c.includes('stable')) return `Use the stable asset once a week for a swap or a payment.`;
  if (c.includes('rwa')) return `Claim and restake the asset's yield once a week.`;
  if (c.includes('insurance')) return `Check the cover once a week and extend it before it lapses.`;
  if (c.includes('basis')) return `Check the funding-rate report once a week and top the position up once.`;
  if (c.includes('payment')) return `Make one payment through ${name} each week from the same wallet.`;
  if (c.includes('privacy')) return `Make one transfer through ${name} each week from the same wallet.`;
  if (c.includes('option')) return `Roll the position once a week when the vault's epoch turns over.`;
  if (c.includes('index')) return `Add a small amount to the index position once a week after its rebalance.`;
  if (c.includes('governance')) return `Vote in one live proposal each week from the same wallet.`;
  if (c.includes('card')) return `Use the ${name} card for one purchase each week.`;
  if (c.includes('otc')) return `Place one order through ${name} each week.`;
  if (c.includes('cedefi')) return `Use ${name}'s main product once a week from the same wallet.`;
  if (c.includes('btc') || c.includes('bitcoin')) return `Claim the BTC yield once a week and restake it through ${name}.`;
  if (c.includes('chain')) return `Use one app on ${chain} each week from the same wallet.`;
  return `Make one qualifying action each week, such as a deposit, a swap, a borrow or a vote, so the wallet stays active.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Costs are approximate; the chain's gas is a public estimate for one simple transaction.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasUsd(chain);
  const gasStr = gasText(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = weeksFor(hold);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${gasStr} of gas for the first transaction`,
      time: '5 minutes',
      gas_usd: gas,
    },
    {
      text: primaryAction(p, capital, chain),
      cost: `$${capital} of capital and about ${gasStr} of gas`,
      time: '15 minutes to set up',
      gas_usd: gas,
    },
    {
      text: secondaryAction(p, chain),
      cost: `about ${gasStr} of gas`,
      time: '10 minutes',
      gas_usd: gas,
    },
    {
      text: `${weeklyAction(p, chain)} Repeat it for ${weeks} week${weeks === 1 ? '' : 's'} so the wallet stays active.`,
      cost: `about ${gasStr} of gas a week`,
      time: `10 minutes a week, ${weeks} weeks`,
      gas_usd: round2(gas * weeks),
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
      gas_usd: 0,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from its official site and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
      gas_usd: 0,
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
      gas_usd: 0,
    },
  ];
}

/** A plan's totals: the capital it ties up, the gas it spends, and the days it runs. */
export function farmSummary(steps: FarmStep[], p: SnapshotProtocol, age: number | null): FarmSummary {
  return {
    capital_usd: capitalFor(p),
    gas_usd: round2(steps.reduce((n, s) => n + s.gas_usd, 0)),
    days: holdDaysFor(age),
    steps: steps.length,
  };
}

// ---------------------------------------------------------------- assembly

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The derived category multiples, strongest first, for the dashboard's model table (n >= 3 only). */
export function multiplesTable(snapshot: Snapshot, ctx: ModelContext): CategoryMultiple[] {
  const rows: CategoryMultiple[] = [];
  for (const [key, stats] of ctx.categoryStats) {
    if (stats.n < MIN_LIVE_FOR_CATEGORY) continue;
    const shrunk = (stats.n * stats.median + ctx.model.shrink_prior * ctx.globalMedian) / (stats.n + ctx.model.shrink_prior);
    const multiple = clampMultiple(shrunk, ctx.model);
    rows.push({ category: key === '' ? '(no category)' : key, live_n: stats.n, median: round4(stats.median), multiple: round4(multiple) });
  }
  rows.sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return rows;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const ctx = deriveContext(snapshot, model);
  const board = buildBoard(snapshot, ctx);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const setAside = setAsideBreakdown(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    snapshot_protocols: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: preToken - board.length,
    set_aside_tvl_usd: setAside.reduce((n, g) => n + g.tvl_usd, 0),
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    global_median: round4(ctx.globalMedian),
    multiples: multiplesTable(snapshot, ctx),
    calibration: calibrate(snapshot, model),
    set_aside: setAside,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a protocol the snapshot lists`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
