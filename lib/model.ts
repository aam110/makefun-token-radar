// Token Radar, model radar-4: one sealed snapshot in, one ranked board out.
//
// The board ranks the snapshot's pre-token protocols by implied value — what a
// token would be worth if the protocol's record stayed as it is. It never
// predicts whether or when a token launches, and it never special-cases a
// protocol by name: one function scores every row from the snapshot's own
// figures (TVL, seven-day growth, age with no token, chains, category).
//
// radar-4's formula:
//
//   implied = TVL x category multiple x growth x maturity x breadth
//               x dominance x size
//
// - category multiple: the geometric mean of the live tokens' market-cap-per-
//   TVL in the same category, shrunk toward the global geometric mean with a
//   hierarchical prior of strength k=4 (a category with 4 live tokens counts
//   as much as the prior). No hard n>=3 cutoff: small categories blend
//   smoothly toward the global centre instead of flipping to it. Clamped to
//   [0.02x, 3x].
// - growth: log-damped seven-day TVL change, (1 + g/100)^0.5 with g clamped
//   to [-50%, +200%]. A +100% week multiplies by sqrt(2); a -50% week by
//   sqrt(1/2): symmetric in log space, so a spike and a crash cancel.
// - maturity: 0.6 + 0.4 x min(age, 1095d)/1095d; an unknown age counts 365d.
// - breadth: 1 + 0.02 per chain beyond the first, capped at five extra.
// - dominance: 1 + 0.5 x the protocol's share of its category's TVL.
// - size: a fitted curve, exp(slope x (ln TVL - mean ln TVL)), clamped to
//   [1/3, 3]. The slope is fitted by least squares on the live tokens'
//   residual log-ratios (after the multiple and the other factors): on this
//   snapshot it is about -0.39, i.e. the market values each extra TVL dollar
//   less than the last. The fit is recomputed from the snapshot on every run.
//
// Calibration: the model is scored by leave-one-out prediction on the
// snapshot's 128 live-token protocols with a positive market cap (16 live
// records carry a market cap of 0 or -1 and cannot calibrate a multiple).
// Each prediction leaves the protocol out of its category multiple and out
// of the size fit. The dashboard states the result honestly, including the
// limit: the model prices each category's centre, never a single token's cap.
//
// The board covers the whole 40-protocol watchlist and adds every other
// pre-token protocol the house's own watchlist rule would keep (198 rows).
// The 144 pre-token protocols the rule sets aside — exchanges, bridges,
// liquid staking and restaking, versioned pools, wrapped/staked products —
// are listed with reasons, never ranked.

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

/** radar-4's constants, as the dashboard states them. */
export interface ModelConstants {
  /** Hierarchical shrinkage strength for the category multiple. */
  shrinkage_k: number;
  /** Clamp on the category multiple. */
  multiple_floor: number;
  multiple_cap: number;
  /** Growth clamp (per cent) and log-damping exponent. */
  growth_floor: number;
  growth_cap: number;
  growth_exponent: number;
  /** Maturity range and cap (days); the age used when listed_at is unknown. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Breadth premium per extra chain, and how many extra chains count. */
  breadth_per_chain: number;
  breadth_max_chains: number;
  /** Dominance premium per unit of category TVL share. */
  dominance_weight: number;
  /** Clamp on the fitted size factor. */
  size_floor: number;
  size_cap: number;
  /** Fitted size slope and the centre it is fitted around (log TVL). */
  size_slope: number;
  size_centre_log_tvl: number;
  /** Global geometric mean mcap/TVL of the live set. */
  global_multiple: number;
}

export const MODEL_VERSION = 'radar-4';

const DAY_MS = 86_400_000;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// ------------------------------------------------------------ set-aside rule

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A product named for an exchange. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories the house's watchlist rule leaves out. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is set aside instead of ranked, or null when it may be ranked. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return p.category;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked/staking word';
  if (EXCHANGE_NAME.test(p.name)) return 'exchange name';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and kept by the watchlist rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

// ------------------------------------------------------------ model plumbing

/** Per-protocol inputs the factors read, derived once from the snapshot. */
interface RowInputs {
  age: number;
  growth: number;
  chains: number;
  share: number;
}

function rowInputs(p: SnapshotProtocol, asOf: string, catTvl: Map<string, number>): RowInputs {
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const growth = finite(p.change_7d, 0);
  const total = catTvl.get(p.category ?? 'Other') ?? p.tvl_usd;
  return { age, growth, chains: p.chains.length, share: total > 0 ? p.tvl_usd / total : 0 };
}

/** The fitted model: multiples, the size curve, and the live set behind them. */
export interface FittedModel {
  constants: ModelConstants;
  /** Category -> shrunk multiple, fitted on the whole live set. */
  multiples: Map<string, { n: number; multiple: number; raw: number }>;
  /** Category -> total TVL across the whole snapshot. */
  catTvl: Map<string, number>;
  /** The live-token protocols (mcap > 0) the multiples and the size fit read. */
  live: SnapshotProtocol[];
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A category multiple from a list of log-ratios, shrunk toward the global log-mean. */
function shrunkMultiple(catLog: number[], globalLogMean: number, k: number): number {
  const n = catLog.length;
  const centre = n === 0 ? globalLogMean : mean(catLog);
  const m = Math.exp((n * centre + k * globalLogMean) / (n + k));
  return Math.min(3.0, Math.max(0.02, m));
}

/** Least-squares slope of ys on xs. */
function fitSlope(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function growthFactor(growth: number): number {
  const c = Math.min(200, Math.max(-50, growth));
  return Math.pow(1 + c / 100, 0.5);
}

function maturityFactor(age: number): number {
  return 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
}

function breadthFactor(chains: number): number {
  return 1 + 0.02 * Math.min(Math.max(chains - 1, 0), 5);
}

function dominanceFactor(share: number): number {
  return 1 + 0.5 * share;
}

function sizeFactor(tvl: number, slope: number, centre: number): number {
  const raw = Math.exp(slope * (Math.log(tvl) - centre));
  return Math.min(3, Math.max(1 / 3, raw));
}

/** The four non-size factors for one protocol, as one product. */
function otherFactors(inp: RowInputs): number {
  return growthFactor(inp.growth) * maturityFactor(inp.age) * breadthFactor(inp.chains) * dominanceFactor(inp.share);
}

/**
 * Fit radar-4 on the snapshot: the live set's log-ratios by category, the
 * shrunk multiples, and the size slope fitted on the residual log-ratios
 * after the multiple and the other factors. `excludeSlug` leaves one live
 * protocol out of every fitted quantity (leave-one-out calibration).
 */
export function fitModel(snapshot: Snapshot, excludeSlug: string | null = null): FittedModel {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.slug !== excludeSlug);
  const catTvl = new Map<string, number>();
  for (const p of snapshot.protocols) {
    const c = p.category ?? 'Other';
    catTvl.set(c, (catTvl.get(c) ?? 0) + p.tvl_usd);
  }
  const logByCat = new Map<string, number[]>();
  const allLog: number[] = [];
  for (const p of live) {
    const lr = Math.log(p.mcap_usd! / p.tvl_usd);
    const c = p.category ?? 'Other';
    if (!logByCat.has(c)) logByCat.set(c, []);
    logByCat.get(c)!.push(lr);
    allLog.push(lr);
  }
  const globalLogMean = mean(allLog);
  const multiples = new Map<string, { n: number; multiple: number; raw: number }>();
  for (const [c, logs] of logByCat) {
    multiples.set(c, {
      n: logs.length,
      multiple: shrunkMultiple(logs, globalLogMean, 4),
      raw: Math.exp(mean(logs)),
    });
  }
  // The size slope is fitted on what the multiple and the other factors
  // leave unexplained, so nothing is counted twice.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of live) {
    const inp = rowInputs(p, snapshot.as_of, catTvl);
    const mult = multiples.get(p.category ?? 'Other')?.multiple ?? Math.exp(globalLogMean);
    xs.push(Math.log(p.tvl_usd));
    ys.push(Math.log(p.mcap_usd! / p.tvl_usd) - Math.log(mult) - Math.log(otherFactors(inp)));
  }
  const slope = fitSlope(xs, ys);
  const centre = mean(xs);
  const constants: ModelConstants = {
    shrinkage_k: 4,
    multiple_floor: 0.02,
    multiple_cap: 3.0,
    growth_floor: -50,
    growth_cap: 200,
    growth_exponent: 0.5,
    maturity_floor: 0.6,
    maturity_range: 0.4,
    maturity_days: 1095,
    unknown_age_days: 365,
    breadth_per_chain: 0.02,
    breadth_max_chains: 5,
    dominance_weight: 0.5,
    size_floor: 1 / 3,
    size_cap: 3,
    size_slope: slope,
    size_centre_log_tvl: centre,
    global_multiple: Math.exp(globalLogMean),
  };
  return { constants, multiples, catTvl, live };
}

/** Every factor of one protocol's implied value, under a fitted model. */
export interface ScoreBreakdown {
  multiple: number;
  multiple_n: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  dominance_multiplier: number;
  size_multiplier: number;
  age_days: number | null;
  implied: number;
}

export function scoreProtocol(p: SnapshotProtocol, snapshot: Snapshot, fitted: FittedModel): ScoreBreakdown {
  const inp = rowInputs(p, snapshot.as_of, fitted.catTvl);
  const entry = fitted.multiples.get(p.category ?? 'Other');
  const multiple = entry?.multiple ?? fitted.constants.global_multiple;
  const gm = growthFactor(inp.growth);
  const mm = maturityFactor(inp.age);
  const bm = breadthFactor(inp.chains);
  const dm = dominanceFactor(inp.share);
  const sm = sizeFactor(p.tvl_usd, fitted.constants.size_slope, fitted.constants.size_centre_log_tvl);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * gm * mm * bm * dm * sm));
  return {
    multiple,
    multiple_n: entry?.n ?? 0,
    growth_pct: Math.min(200, Math.max(-50, inp.growth)),
    growth_multiplier: gm,
    maturity_multiplier: mm,
    breadth_multiplier: bm,
    dominance_multiplier: dm,
    size_multiplier: sm,
    age_days: ageDays(snapshot.as_of, p.listed_at),
    implied,
  };
}

// --------------------------------------------------------------- calibration

/** Leave-one-out calibration of the model on the snapshot's live tokens. */
export interface Calibration {
  n: number;
  median_ratio: number;
  p25_ratio: number;
  p75_ratio: number;
  within_2x: number;
  within_3x: number;
  within_5x: number;
  mean_abs_log_error: number;
}

const medianOf = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};

/**
 * Leave-one-out calibration: predict each live token's market cap with a
 * model fitted without it, and compare predicted to actual. The ratios are
 * the honest measure of what the model can and cannot do.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const ratios: number[] = [];
  for (const p of live) {
    const fitted = fitModel(snapshot, p.slug);
    const score = scoreProtocol(p, snapshot, fitted);
    ratios.push(score.implied / p.mcap_usd!);
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const q = (f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1)))]!;
  const within = (k: number): number => ratios.filter((r) => r >= 1 / k && r <= k).length / ratios.length;
  return {
    n: ratios.length,
    median_ratio: medianOf(ratios),
    p25_ratio: q(0.25),
    p75_ratio: q(0.75),
    within_2x: within(2),
    within_3x: within(3),
    within_5x: within(5),
    mean_abs_log_error: ratios.reduce((a, r) => a + Math.abs(Math.log(r)), 0) / ratios.length,
  };
}

// ---------------------------------------------------------------- farm plans

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A plan's totals, shown as chips in the detail view. */
export interface FarmSummary {
  capital_usd: number;
  gas_usd: number;
  gas_per_week_usd: number;
  days: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  transactions: number;
}

/** Typical gas for one transaction on each chain, in USD (estimates, stated as such). */
const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 4.0,
  Arbitrum: 0.25,
  Optimism: 0.2,
  Base: 0.15,
  Binance: 0.15,
  Solana: 0.01,
  Avalanche: 0.3,
  Polygon: 0.05,
  Tron: 0.3,
  Sui: 0.02,
  'Hyperliquid L1': 0.05,
  Linea: 0.15,
  'zkSync Era': 0.2,
  Scroll: 0.2,
  Mantle: 0.05,
  Berachain: 0.05,
  Sonic: 0.05,
  Fantom: 0.05,
  Celo: 0.02,
  xDai: 0.02,
  Blast: 0.1,
  Cronos: 0.1,
  Monad: 0.02,
  Plasma: 0.1,
  Unichain: 0.1,
  Sei: 0.02,
  Aptos: 0.02,
  Near: 0.02,
  Kava: 0.05,
  Mode: 0.05,
  Metis: 0.05,
  Starknet: 0.3,
  Manta: 0.1,
  Zora: 0.05,
  'World Chain': 0.05,
  Op_Bnb: 0.05,
  'Polygon zkEVM': 0.1,
  ArbitrumNova: 0.05,
  'Arbitrum Nova': 0.05,
  Gnosis: 0.02,
  Moonbeam: 0.05,
  Aurora: 0.05,
  Harmony: 0.02,
  Fuse: 0.02,
  Klaytn: 0.05,
  Fraxtal: 0.05,
  Ink: 0.05,
  Taiko: 0.1,
  Morph: 0.1,
  Soneium: 0.05,
  Abstract: 0.05,
  ApeChain: 0.05,
  Katana: 0.05,
  Hemi: 0.05,
  Plume: 0.05,
  'Plume Mainnet': 0.05,
  Swellchain: 0.05,
  'BOB': 0.05,
  Corn: 0.05,
  '0G': 0.05,
  MegaETH: 0.02,
  Tempo: 0.02,
  Etherlink: 0.02,
  'X Layer': 0.05,
  Ronin: 0.02,
  'Bittensor EVM': 0.05,
  'HashKey Chain': 0.05,
  'Zircuit': 0.1,
  'LightLink': 0.01,
  'Sophon': 0.05,
  'Mint': 0.05,
  'Gravity': 0.05,
  'LUKSO': 0.05,
  'REI': 0.02,
  'Songbird': 0.02,
  'Flare': 0.02,
  'Hedera': 0.02,
  'Telos': 0.02,
  'WEMIX': 0.05,
  'Kroma': 0.05,
  'Boba': 0.05,
  'Electroneum': 0.02,
  'Stratis': 0.05,
  'Meter': 0.02,
  'Neon': 0.02,
  'Fuel': 0.02,
  'Kadena': 0.02,
  'IOTA': 0.01,
  'Oasys': 0.02,
  'Xai': 0.02,
  'Bitkub': 0.05,
  'Elysium Kinetiq': 0.05,
  'Astar': 0.05,
  'Acala': 0.05,
  'Karura': 0.02,
  'Moonriver': 0.02,
  'Shiden': 0.02,
  'Astar zkEVM': 0.05,
};

/** Gas for one transaction on a chain, or the default when the chain is unlisted. */
export function gasPerTx(chain: string): number {
  return CHAIN_GAS_USD[chain] ?? 0.5;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

const CAT = (p: SnapshotProtocol): string => (p.category ?? '').toLowerCase();

/** The category's core action, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = CAT(p);
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name}'s lending market on ${chain} and leave it earning.`;
  if (c.includes('dex') || c.includes('liquidity manager'))
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} (a stable pair if one exists) and keep the LP position.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged'))
    return `Deposit $${capital} into ${name}'s main yield vault on ${chain} and keep the receipt token.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farm wallet.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small position (2x leverage at most).`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} through ${name} on ${chain} and keep the receipt token.`;
  if (c === 'chain')
    return `Bridge $${capital} to ${chain} and use it inside ${name}'s own app — stake, swap or provide liquidity.`;
  if (c.includes('prediction'))
    return `Fund the wallet with $${capital} and open one position in ${name}'s most liquid market.`;
  if (c.includes('stablecoin') || c.includes('anchor btc') || c.includes('decentralized btc'))
    return `Mint or wrap $${capital} through ${name} on ${chain} and hold the wrapped asset.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different qualifying action, so the wallet shows more than one behaviour. */
function secondAction(p: SnapshotProtocol): string {
  const c = CAT(p);
  if (c.includes('dex') || c.includes('liquidity manager'))
    return `Swap a small amount through the pool so the wallet shows both sides of the market, not only the deposit.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow a small amount (under a third of the collateral) and repay half of it a week later, to show borrowing activity.`;
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('options'))
    return `Open one small hedged position and close it within the week, to show trading activity beside the margin deposit.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged'))
    return `Stake the receipt token from the deposit in the protocol's rewards contract, if it has one.`;
  if (c.includes('rwa'))
    return `Use the minted asset once — supply it to a lending pool or move it to a second wallet — so it is not only held.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit a smaller amount into a second vault of the same curator, so the wallet is spread across two strategies.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Delegate or restake the receipt token if the protocol offers it, so the stake compounds.`;
  if (c === 'chain')
    return `Interact with one dapp on the chain beyond the bridge — a swap or a stake — so the wallet has on-chain history.`;
  if (c.includes('prediction'))
    return `Place a second position in a different market, so the wallet is not a one-trade account.`;
  if (c.includes('stablecoin') || c.includes('anchor btc') || c.includes('decentralized btc'))
    return `Swap half the wrapped asset back to test redemption, then re-mint it, so both directions are on record.`;
  return `Make one more qualifying action in the same week — a swap, a vote or a second deposit — so the wallet is not a one-action account.`;
}

/** The category's weekly action: the cadence that keeps the farm alive across snapshots. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = CAT(p);
  if (c.includes('dex') || c.includes('liquidity manager'))
    return `Each week, collect accrued fees and check the pool's price range; re-range only if the price left your band.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Each week, check the health factor and the borrow rate; top up collateral if the factor fell below 2.`;
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('options'))
    return `Each week, roll or close the hedge and re-check funding; never leave a margined position unattended for a month.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged'))
    return `Each week, harvest rewards and restake them; log each harvest so the position compounds visibly.`;
  if (c.includes('rwa'))
    return `Each week, confirm the yield accrual landed and the backing attestation is current.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Each week, read the curator's allocation note and check the vault's share price against your entry.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Each week, check pending rewards and the unbonding queue so nothing sits unclaimed.`;
  if (c === 'chain')
    return `Each week, make one real transaction on the chain — a swap, a stake or a dapp interaction.`;
  if (c.includes('prediction'))
    return `Each week, review the open markets and close or add one position.`;
  if (c.includes('stablecoin') || c.includes('anchor btc') || c.includes('decentralized btc'))
    return `Each week, check the peg and the redemption queue for any drift.`;
  return `Each week, make one qualifying action — a deposit, a swap, a vote or a claim — so the activity spans snapshots.`;
}

/** The category's risk, stated plainly with the limit that keeps it affordable. */
function riskNote(p: SnapshotProtocol): string {
  const c = CAT(p);
  if (c.includes('dex') || c.includes('liquidity manager'))
    return `Risk — impermanent loss: if the pool's prices move apart, withdrawing can return less than holding. Size the position so a 20% divergence is affordable.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Risk — liquidation only bites if you borrow: keep the health factor above 2 and never borrow more than half the collateral.`;
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('options'))
    return `Risk — leverage cuts both ways: a small move can liquidate a margined position. Keep leverage at or below 2x and size for a total loss.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged'))
    return `Risk — yield comes from somewhere: read what pays it (fees, emissions or leverage) before sizing up; emissions-funded yield fades.`;
  if (c.includes('rwa'))
    return `Risk — the asset is only as good as its issuer and custodian: check who holds the underlying and how redemption works.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Risk — you trust the curator's strategy: a vault can lose value if its allocations sour. Spread across two vaults, not one.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Risk — staked assets can be locked or slashed: check the unbonding period before depositing.`;
  if (c === 'chain')
    return `Risk — a young chain can halt or reorg: keep farm funds small until the chain has a year of uptime.`;
  if (c.includes('prediction'))
    return `Risk — a wrong outcome pays zero: never stake more than you would spend on the information.`;
  if (c.includes('stablecoin') || c.includes('anchor btc') || c.includes('decentralized btc'))
    return `Risk — peg risk: the wrapped asset can trade below its backing in a stress event. Watch the peg weekly.`;
  return `Risk — smart-contract risk applies to every protocol: a bug or exploit can take the deposit. Never farm with money you cannot lose.`;
}

/** How hard the plan is to run, from the category's mechanics. */
function difficultyFor(p: SnapshotProtocol): FarmSummary['difficulty'] {
  const c = CAT(p);
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('options') || c.includes('leveraged'))
    return 'Advanced';
  if (c.includes('dex') || c.includes('lend') || c.includes('cdp') || c.includes('yield') || c.includes('liquidity manager') || c.includes('restak'))
    return 'Intermediate';
  return 'Beginner';
}

const fmtGas = (n: number): string => (n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`);

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. Gas is priced per
 * transaction on the protocol's first chain, so the totals differ by chain.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: FarmStep[]; summary: FarmSummary } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasPerTx(chain);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  // Transactions: setup, bridge, core action, second action, one a week, exit.
  const txCount = 5 + weeks;
  const gasTotal = Math.round((gas * txCount + 1.5) * 100) / 100;
  const gasWeek = Math.round(gas * 100) / 100;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${fmtGas(gas)} of gas on ${chain} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: `Fund the wallet with $${capital + 10} of USDC and bridge it to ${chain} through the bridge the protocol's own docs name.`,
      cost: `about $1.50 bridge fee plus ${fmtGas(gas)} of gas`,
      time: '15 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital and about ${fmtGas(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p),
      cost: `about ${fmtGas(gas)} of gas`,
      time: '10 minutes',
    },
    {
      text: weeklyAction(p),
      cost: `about ${fmtGas(gas)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Open the protocol's own points or rewards page once a week and write down the balance, the rank and the next snapshot date.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: riskNote(p),
      cost: 'no fee — this step is a read, not a transaction',
      time: 'read before depositing',
    },
    {
      text: `Before you withdraw, claim only from the link the protocol itself publishes, then unwind in two moves and log every transaction.`,
      cost: `about ${fmtGas(gas)} of gas to exit`,
      time: '15 minutes',
    },
  ];
  return {
    steps,
    summary: {
      capital_usd: capital,
      gas_usd: gasTotal,
      gas_per_week_usd: gasWeek,
      days: hold,
      difficulty: difficultyFor(p),
      transactions: txCount,
    },
  };
}

// ------------------------------------------------------------- board + radar

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
  age_days: number | null;
  implied_value_usd: number;
  model: ScoreBreakdown;
  farm_steps: string[];
  farm_summary: FarmSummary;
  watchlist: boolean;
  early: boolean;
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  dominance_multiplier: number;
  size_multiplier: number;
  farm_steps: string[];
  farm_summary: FarmSummary;
  watchlist: boolean;
  early: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

/** One set-aside reason: how many protocols, how much TVL, and examples. */
export interface SetAsideGroup {
  reason: string;
  count: number;
  tvl_usd: number;
  examples: string[];
}

/** One focus pick: a protocol the week favours, and why in one line. */
export interface FocusPick {
  slug: string;
  rank: number;
  name: string;
  category: string | null;
  implied_value_usd: number;
  change_7d: number | null;
  reason: string;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  set_aside_tvl_usd: number;
  total_implied_usd: number;
  calibration: Calibration;
  multiples: { category: string; n: number; multiple: number; raw: number }[];
  size_curve: { tvl_usd: number; label: string; factor: number }[];
  focus: FocusPick[];
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideGroup[];
  cat_tvl: Record<string, number>;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fitted: FittedModel): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  const scored = chosen.map((p) => {
    const score = scoreProtocol(p, snapshot, fitted);
    const plan = farmPlan(p, score.age_days);
    return { p, score, plan };
  });
  scored.sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    age_days: s.score.age_days,
    implied_value_usd: s.score.implied,
    model: {
      ...s.score,
      multiple: round4(s.score.multiple),
      growth_multiplier: round4(s.score.growth_multiplier),
      maturity_multiplier: round4(s.score.maturity_multiplier),
      breadth_multiplier: round4(s.score.breadth_multiplier),
      dominance_multiplier: round4(s.score.dominance_multiplier),
      size_multiplier: round4(s.score.size_multiplier),
    },
    farm_steps: s.plan.steps.map(stepText),
    farm_summary: s.plan.summary,
    watchlist: watch.has(s.p.slug),
    early: !watch.has(s.p.slug),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view and its recompute. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** The set-aside breakdown: one group per reason, largest first. */
export function setAsideGroups(snapshot: Snapshot): SetAsideGroup[] {
  const groups = new Map<string, { count: number; tvl: number; names: { name: string; tvl: number }[] }>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = setAsideReason(p);
    if (reason === null) continue;
    if (!groups.has(reason)) groups.set(reason, { count: 0, tvl: 0, names: [] });
    const g = groups.get(reason)!;
    g.count += 1;
    g.tvl += p.tvl_usd;
    g.names.push({ name: p.name, tvl: p.tvl_usd });
  }
  return [...groups.entries()]
    .map(([reason, g]) => ({
      reason,
      count: g.count,
      tvl_usd: g.tvl,
      examples: g.names.sort((a, b) => b.tvl - a.tvl).slice(0, 3).map((x) => x.name),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

const fmtMoneyShort = (n: number): string => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
};

/**
 * This week's focus: the eight highest-valued rows whose TVL grew in the
 * last seven days, ranked by implied value times their growth factor — the
 * biggest launches with the freshest momentum. The rule is stated in the
 * dashboard, and the score is recomputed there.
 */
export function focusPicks(board: BoardRow[]): FocusPick[] {
  const fmtPct = (n: number | null): string =>
    n === null ? 'no 7d change reported' : `${n > 0 ? '+' : ''}${n.toFixed(1)}% TVL in 7 days`;
  return [...board]
    .filter((r) => r.change_7d !== null && r.change_7d > 0)
    .map((r) => ({ r, focus: r.implied_value_usd * r.model.growth_multiplier }))
    .sort((a, b) => b.focus - a.focus || (a.r.slug < b.r.slug ? -1 : 1))
    .slice(0, 8)
    .map(({ r }) => ({
      slug: r.slug,
      rank: r.rank,
      name: r.name,
      category: r.category,
      implied_value_usd: r.implied_value_usd,
      change_7d: r.change_7d,
      reason: `${fmtPct(r.change_7d)} · ${fmtMoneyShort(r.implied_value_usd)} implied · ${r.chains[0] ?? 'its main chain'}`,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fitted = fitModel(snapshot);
  const board = buildBoard(snapshot, fitted);
  const live = liveRows(snapshot);
  const calibration = calibrate(snapshot);
  const early = board.filter((r) => r.early).length;
  const setAside = setAsideGroups(snapshot);
  const multiples = [{ category: 'Global (all live tokens)', n: live.length, multiple: round4(fitted.constants.global_multiple), raw: round4(fitted.constants.global_multiple) }]
    .concat(
      [...fitted.multiples.entries()]
        .map(([category, v]) => ({ category, n: v.n, multiple: round4(v.multiple), raw: round4(v.raw) }))
        .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1)),
    );
  const sizeCurve = [5_000_000, 50_000_000, 500_000_000, 5_000_000_000].map((tvl) => ({
    tvl_usd: tvl,
    label: fmtMoneyShort(tvl),
    factor: round4(sizeFactor(tvl, fitted.constants.size_slope, fitted.constants.size_centre_log_tvl)),
  }));
  const catTvl: Record<string, number> = {};
  for (const [c, v] of [...fitted.catTvl.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) catTvl[c] = v;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      ...fitted.constants,
      // The size slope and centre stay at full precision: the dashboard
      // recomputes every row from them, and rounding would move the check.
      global_multiple: round4(fitted.constants.global_multiple),
    },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.reduce((a, g) => a + g.count, 0),
    set_aside_tvl_usd: setAside.reduce((a, g) => a + g.tvl_usd, 0),
    total_implied_usd: board.reduce((a, r) => a + r.implied_value_usd, 0),
    calibration: {
      ...calibration,
      median_ratio: round4(calibration.median_ratio),
      p25_ratio: round4(calibration.p25_ratio),
      p75_ratio: round4(calibration.p75_ratio),
      within_2x: round4(calibration.within_2x),
      within_3x: round4(calibration.within_3x),
      within_5x: round4(calibration.within_5x),
      mean_abs_log_error: round4(calibration.mean_abs_log_error),
    },
    multiples,
    size_curve: sizeCurve,
    focus: focusPicks(board),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      multiple_n: r.model.multiple_n,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      dominance_multiplier: r.model.dominance_multiplier,
      size_multiplier: r.model.size_multiplier,
      farm_steps: r.farm_steps,
      farm_summary: r.farm_summary,
      watchlist: r.watchlist,
      early: r.early,
    })),
    live,
    set_aside: setAside,
    cat_tvl: catTvl,
  };
  return { board, radar };
}

// ------------------------------------------------------------------- parsing

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

// ------------------------------------------------------------- gate self-check

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `the board invents ${invented[0]!.slug}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
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

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
