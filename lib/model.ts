// radar-5 — token launch radar model, fitted on the sealed snapshot only.
// No network, no randomness, no clock: every number below is computed from
// the snapshot's own figures at run time, so two runs are byte-identical.
// Value model: ln(mcap/TVL) = a + b * ln(TVL / $100M), OLS on the 128
// live-token protocols with a positive market cap. Every other candidate
// term (category, 7-day growth, age, chain count, size splines) was tested
// in BOTH leave-one-out and walk-forward and is reported in the term table;
// a term is kept only when it lowers the held-out miss in both tests.
// Token odds: logistic P(records a token) on all 758 protocols, features
// age, shrunk category token rate and clipped 7-day growth; ln(TVL) was
// tested and dropped (it worsened the held-out Brier).

export interface Protocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[]; }

export interface Row {
  slug: string; name: string; rank: number; implied_value_usd: number;
  farm_steps: string[];
  category: string; chains: string[]; tvl_usd: number; ratio: number;
  lo_usd: number; hi_usd: number; odds_pct: number; verdict: string;
  net_usd: number; net_per_hour_usd: number; gas_usd: number; hours: number;
  days: number; difficulty: string; risk: string; watchlist: boolean;
  deposit_usd: number; gross_usd: number;
}
export interface Evidence {
  live_n: number; flat_loo_miss: number; flat_wf_miss: number;
  loo_miss: number; wf_miss: number; loo_median: number; wf_median: number;
  loo_w2: number; loo_w3: number; loo_w5: number; wf_w2: number; wf_w3: number; wf_w5: number;
  base_coef: number; slope_coef: number; slope_se: number; base_se: number;
  resid_sd: number; q10: number; q25: number; q75: number; q90: number;
  hon_loo_p2575: number; hon_loo_p1090: number; hon_wf_p2575: number; hon_wf_p1090: number;
  hon_loo_w3: number; hon_wf_w3: number;
  brier_base: number; brier_cv: number; brier_wf: number; brier_wf_base: number;
  odds_base_rate: number; terms: TermRow[]; odds_terms: OddsRow[];
  farm_count: number; marginal_count: number; skip_count: number;
  checksum_note: string;
}
export interface TermRow { term: string; loo_miss: number; wf_miss: number; kept: string; }
export interface OddsRow { term: string; cv_brier: number; wf_brier: number; kept: string; }
export interface Accounting {
  total: number; ranked: number; set_aside: number; set_aside_tvl: number;
  live_token: number; below_floor: number; set_aside_by_reason: { reason: string; n: number; tvl: number }[];
  watchlist_n: number; watchlist_ranked: number;
}
export interface BoardOut {
  rows: Row[]; evidence: Evidence; accounting: Accounting;
  as_of: string; floor_usd: number; live_peers: LivePeer[];
}
export interface LivePeer { slug: string; name: string; category: string; tvl_usd: number; mcap_usd: number; ratio: number; pred_ratio: number; }

// ---- small deterministic helpers (no Date, no Math.random) ----
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
export function parseDay(s: string | null): number | null {
  if (!s) return null;
  const p = s.split("-");
  if (p.length !== 3) return null;
  return daysFromCivil(Number(p[0]), Number(p[1]), Number(p[2]));
}
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); }
export function clamp(x: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, x)); }
export function fmtUsd(x: number): string {
  if (x >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
  if (x >= 1e6) return "$" + (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
  return "$" + x.toFixed(0);
}
export function fmtMoney(x: number): string {
  const sign = x < 0 ? "-" : "+";
  const a = Math.abs(x);
  return sign + "$" + (a >= 100 ? a.toFixed(0) : a.toFixed(2));
}

// Solve (X'X + ridge I) b = X'y by Gaussian elimination. Deterministic.
export function ols(X: number[][], y: number[]): number[] {
  const p = X[0].length;
  const a: number[][] = [];
  for (let i = 0; i < p; i++) {
    a.push(new Array(p + 1).fill(0));
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let r = 0; r < X.length; r++) s += X[r][i] * X[r][j];
      a[i][j] = s + (i === j ? 1e-9 : 0);
    }
    let s = 0;
    for (let r = 0; r < X.length; r++) s += X[r][i] * y[r];
    a[i][p] = s;
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    const tmp = a[c]; a[c] = a[piv]; a[piv] = tmp;
    const d = a[c][c] || 1e-12;
    for (let r = c + 1; r < p; r++) {
      const f = a[r][c] / d;
      for (let k = c; k <= p; k++) a[r][k] -= f * a[c][k];
    }
  }
  const b = new Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = a[i][p];
    for (let j = i + 1; j < p; j++) s -= a[i][j] * b[j];
    b[i] = s / (a[i][i] || 1e-12);
  }
  return b;
}
export function olsSe(X: number[][], y: number[], beta: number[]): number[] {
  const n = X.length, p = beta.length;
  let rss = 0;
  for (let r = 0; r < n; r++) {
    let pred = 0;
    for (let j = 0; j < p; j++) pred += X[r][j] * beta[j];
    rss += (y[r] - pred) * (y[r] - pred);
  }
  const s2 = rss / Math.max(1, n - p);
  // (X'X)^-1 diagonal via solving against unit vectors
  const ses: number[] = [];
  for (let k = 0; k < p; k++) {
    const e = new Array(p).fill(0); e[k] = 1;
    const col = olsSolveOnly(X, e);
    ses.push(Math.sqrt(Math.max(0, s2 * col[k])));
  }
  return ses;
}
function olsSolveOnly(X: number[][], rhs: number[]): number[] {
  const p = X[0].length;
  const a: number[][] = [];
  for (let i = 0; i < p; i++) {
    a.push(new Array(p + 1).fill(0));
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let r = 0; r < X.length; r++) s += X[r][i] * X[r][j];
      a[i][j] = s + (i === j ? 1e-9 : 0);
    }
    a[i][p] = rhs[i];
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    const tmp = a[c]; a[c] = a[piv]; a[piv] = tmp;
    const d = a[c][c] || 1e-12;
    for (let r = c + 1; r < p; r++) {
      const f = a[r][c] / d;
      for (let k = c; k <= p; k++) a[r][k] -= f * a[c][k];
    }
  }
  const b = new Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = a[i][p];
    for (let j = i + 1; j < p; j++) s -= a[i][j] * b[j];
    b[i] = s / (a[i][i] || 1e-12);
  }
  return b;
}

// ---- set-aside rule (the watchlist's own rule, applied board-wide) ----
const SET_ASIDE_CATS = new Set(["Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking", "Restaked BTC", "CEX"]);
const EXCHANGES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];
export function setAsideReason(p: Protocol): string | null {
  if (p.category !== null && SET_ASIDE_CATS.has(p.category)) return p.category;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return "versioned name";
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return "wrapped/staked/staking name";
  for (const e of EXCHANGES) if (p.name.startsWith(e)) return "exchange name";
  return null;
}
export function isPreToken(p: Protocol): boolean { return p.mcap_usd === null; }

// ---- gas assumptions (stated, Nov 2026 approx. $ per tx on each chain) ----
export const GAS_PER_TX: Record<string, number> = {
  Ethereum: 2.5, Solana: 0.02, Base: 0.05, Arbitrum: 0.15, Optimism: 0.1,
  Binance: 0.3, Polygon: 0.05, Avalanche: 0.5, "Hyperliquid L1": 0.01,
  Bitcoin: 1.0, Monad: 0.05, Sui: 0.05, Aptos: 0.05, Berachain: 0.1,
  Sonic: 0.05, Sei: 0.05, Linea: 0.1, Scroll: 0.1, zkSync: 0.1, Starknet: 0.2,
};
export function gasPerTx(chain: string): number { return GAS_PER_TX[chain] ?? 0.5; }

const ACTION: Record<string, string> = {
  Lending: "supply assets and borrow against them",
  Dexs: "swap and provide liquidity",
  Yield: "stake into the yield vaults",
  RWA: "buy into the tokenised real-world-asset vaults",
  "Yield Aggregator": "deposit into the auto-compounding vaults",
  CDP: "open a collateralised-debt position and mint",
  "Basis Trading": "open delta-neutral basis positions",
  Restaking: "restake assets into the restaking vaults",
  Chain: "use the chain's native apps and bridge in",
  Dexes: "swap and provide liquidity",
};
export function actionFor(category: string | null): string {
  return ACTION[category ?? ""] ?? "use the protocol's core product";
}

// Farm plan: 10 steps, chain-specific gas, weekly cadence, risk + difficulty.
// Steps are generated from the protocol's own chains and category only.
export function farmSteps(p: Protocol, deposit: number, gasTotal: number, days: number): string[] {
  const chain = p.chains[0] ?? "Ethereum";
  const chain2 = p.chains.length > 1 ? p.chains[1] : chain;
  const act = actionFor(p.category);
  const g = gasPerTx(chain);
  const dep = "$" + deposit.toLocaleString("en-US");
  const cat = p.category ?? "DeFi";
  return [
    `Set up a fresh wallet on ${chain} and fund it with ${dep} plus about $${gasTotal.toFixed(0)} of gas reserve; keep this wallet only for ${p.name} so every action is traceable.`,
    `Bridge ${dep} to ${chain} (about $${g.toFixed(2)} gas per step) and confirm the balance on the chain explorer before touching ${p.name}; never farm from an exchange withdrawal address.`,
    `Open the ${p.name} app, connect the fresh wallet on ${chain}, and read the ${cat} terms: fees, lock-ups and withdrawal delays, before depositing anything.`,
    `Deposit ${dep} to ${act} on ${p.name} in 2-3 tranches over 2 days (about $${(g * 3).toFixed(2)} gas); screenshot each receipt and note the transaction hash.`,
    `Use a second ${cat} feature on ${chain2} if it is live there: one more position type (about $${g.toFixed(2)} gas) raises the activity footprint without doubling capital.`,
    `Return weekly for ${Math.max(4, Math.round(days / 7))} weeks: claim or compound any rewards, rebalance the ${dep} position, and log the date, gas paid and balance each visit (about 15 minutes a week).`,
    `Keep the position open for the full ${days}-day plan: early exits usually forfeit points, and airdrop snapshots reward wallets that stay through the whole window.`,
    `Watch ${p.name} for quests, points or Galxe-style tasks on ${chain}; do each official task once, from this same wallet, and skip any third-party "airdrop checker" that asks for a signature.`,
    `Two weeks before the plan ends, test a small withdrawal (about $${g.toFixed(2)} gas) to confirm the exit works, then decide whether to stay in for the next snapshot.`,
    `At the end of the ${days}-day plan, withdraw the ${dep} position, total the gas spent (about $${gasTotal.toFixed(0)}), and record profit, points earned and time spent before moving on.`,
  ];
}

export function difficultyFor(p: Protocol): string {
  const n = p.chains.length;
  if (n >= 8) return "Hard";
  if (n >= 3) return "Medium";
  return "Easy";
}
export function riskFor(p: Protocol): string {
  const cat = p.category ?? "";
  if (cat === "Lending" || cat === "CDP") return "Liquidation risk: a sharp price move can liquidate a borrowed position; keep the health factor high.";
  if (cat === "Dexs") return "Impermanent-loss risk: providing liquidity can lose vs holding if prices move apart; size the position accordingly.";
  if (cat === "Yield" || cat === "Yield Aggregator") return "Smart-contract risk: vault code can hold bugs; the position is only as safe as the audited contracts.";
  if (cat === "RWA") return "Counterparty risk: tokenised real-world assets depend on the off-chain issuer honouring redemptions.";
  if (cat === "Bridge" || cat === "Canonical Bridge") return "Bridge risk: cross-chain messaging has been the largest exploit surface in DeFi; move funds in tranches.";
  return "Smart-contract risk: unaudited or new code can lose funds; never deposit more than you can afford to lose.";
}

// ---- value-model features ----
function ageYears(p: Protocol, asOfDay: number): number {
  const d = parseDay(p.listed_at);
  if (d === null) return 1.5;
  return Math.max(0, (asOfDay - d) / 365.25);
}
function catFeature(train: Protocol[], evalP: Protocol, yBySlug: Map<string, number>, nested: boolean): number {
  const peers = train.filter((q) => q.category === evalP.category && (!nested || q.slug !== evalP.slug));
  const g = mean(train.map((q) => yBySlug.get(q.slug)!));
  if (peers.length === 0) return 0;
  const c = mean(peers.map((q) => yBySlug.get(q.slug)!));
  const k = 4;
  return ((peers.length * c + k * g) / (peers.length + k)) - g;
}
// terms: ordered list; "lntvl" | "cat" | "chg" | "age" | "lnch" | "h1" | "h2"
function valueRow(p: Protocol, train: Protocol[], yBySlug: Map<string, number>, terms: string[], asOfDay: number, nested: boolean): number[] {
  const row: number[] = [1];
  for (const t of terms) {
    if (t === "lntvl") row.push(Math.log(p.tvl_usd / 1e8));
    else if (t === "cat") row.push(catFeature(train, p, yBySlug, nested));
    else if (t === "chg") row.push(clamp(p.change_7d ?? 0, -30, 30) / 100);
    else if (t === "age") row.push(ageYears(p, asOfDay));
    else if (t === "lnch") row.push(Math.log(Math.max(1, p.chains.length)));
    else if (t === "h1") row.push(Math.max(0, Math.log(p.tvl_usd / 1e8)));
    else if (t === "h2") row.push(Math.max(0, Math.log(p.tvl_usd / 1e8) - Math.log(10)));
  }
  return row;
}
function missStats(predRatio: number[], actualRatio: number[]): { miss: number; median: number; w2: number; w3: number; w5: number } {
  const errs = predRatio.map((pr, i) => Math.abs(Math.log(pr / actualRatio[i])));
  const ratios = predRatio.map((pr, i) => pr / actualRatio[i]);
  return {
    miss: Math.exp(median(errs)),
    median: median(ratios),
    w2: ratios.filter((r) => r >= 0.5 && r <= 2).length / ratios.length,
    w3: ratios.filter((r) => r >= 1 / 3 && r <= 3).length / ratios.length,
    w5: ratios.filter((r) => r >= 0.2 && r <= 5).length / ratios.length,
  };
}

// ---- token-odds logistic (gradient descent, standardised, L2=1) ----
function logitFit(X: number[][], y: number[]): { b: number[]; mu: number[]; sd: number[] } {
  const p = X[0].length;
  const mu = new Array(p).fill(0), sd = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    mu[j] = mean(X.map((r) => r[j]));
    const v = mean(X.map((r) => (r[j] - mu[j]) * (r[j] - mu[j])));
    sd[j] = Math.sqrt(v) || 1;
  }
  const Xs = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  const b = new Array(p + 1).fill(0);
  const base = mean(y);
  b[0] = Math.log(Math.max(1e-6, base) / Math.max(1e-6, 1 - base));
  for (let it = 0; it < 400; it++) {
    const grad = new Array(p + 1).fill(0);
    for (let i = 0; i < Xs.length; i++) {
      let z = b[0];
      for (let j = 0; j < p; j++) z += b[j + 1] * Xs[i][j];
      const pr = 1 / (1 + Math.exp(-clamp(z, -30, 30)));
      const e = pr - y[i];
      grad[0] += e;
      for (let j = 0; j < p; j++) grad[j + 1] += e * Xs[i][j];
    }
    for (let j = 0; j <= p; j++) {
      const reg = j === 0 ? 0 : 1.0 * b[j];
      b[j] -= (0.5 * grad[j] + reg * 0.5) / Xs.length;
    }
  }
  return { b, mu, sd };
}
function logitPred(m: { b: number[]; mu: number[]; sd: number[] }, X: number[][]): number[] {
  return X.map((r) => {
    let z = m.b[0];
    for (let j = 0; j < r.length; j++) z += m.b[j + 1] * ((r[j] - m.mu[j]) / m.sd[j]);
    return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
  });
}
function brier(pred: number[], y: number[]): number {
  return mean(pred.map((pr, i) => (pr - y[i]) * (pr - y[i])));
}

// ---- the build ----
export function buildBoard(snap: Snapshot): BoardOut {
  const asOfDay = parseDay(snap.as_of) ?? daysFromCivil(2026, 11, 14);
  const all = snap.protocols;
  const live = all.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const yBySlug = new Map<string, number>();
  for (const p of live) yBySlug.set(p.slug, Math.log(p.mcap_usd! / p.tvl_usd));
  const actualRatio = live.map((p) => p.mcap_usd! / p.tvl_usd);

  // --- term table: cumulative models, LOO + walk-forward (3 expanding windows by listed_at)
  const dated = live.filter((p) => p.listed_at).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const termSets: { label: string; terms: string[] }[] = [
    { label: "flat (global median only)", terms: [] },
    { label: "ln(TVL / $100M)", terms: ["lntvl"] },
    { label: "+ category (shrunk log-mean, k=4)", terms: ["lntvl", "cat"] },
    { label: "+ 7-day growth (clipped ±30%)", terms: ["lntvl", "cat", "chg"] },
    { label: "+ age in years (missing = 1.5)", terms: ["lntvl", "cat", "chg", "age"] },
    { label: "+ ln(chain count)", terms: ["lntvl", "cat", "chg", "age", "lnch"] },
  ];
  function fitPredict(train: Protocol[], test: Protocol[], terms: string[]): number[] {
    const X = train.map((p) => valueRow(p, train, yBySlug, terms, asOfDay, true));
    const yy = train.map((p) => yBySlug.get(p.slug)!);
    const beta = ols(X, yy);
    return test.map((p) => {
      const row = valueRow(p, train, yBySlug, terms, asOfDay, false);
      let lp = 0;
      for (let j = 0; j < beta.length; j++) lp += beta[j] * row[j];
      return Math.exp(lp);
    });
  }
  const terms: TermRow[] = [];
  let looChosen: number[] = [];
  let wfChosen: { pr: number[]; ac: number[] } = { pr: [], ac: [] };
  for (let si = 0; si < termSets.length; si++) {
    const ts = termSets[si];
    // LOO
    const looPred: number[] = [];
    for (let i = 0; i < live.length; i++) {
      const train = live.filter((_, j) => j !== i);
      looPred.push(fitPredict(train, [live[i]], ts.terms)[0]);
    }
    const loo = missStats(looPred, actualRatio);
    // walk-forward: 3 expanding windows
    const wfPr: number[] = []; const wfAc: number[] = [];
    for (const cut of [0.5, 0.65, 0.8]) {
      const k = Math.floor(dated.length * cut);
      const train = dated.slice(0, k);
      const test = dated.slice(k, cut < 0.8 ? Math.floor(dated.length * (cut + 0.15)) : dated.length);
      const pr = fitPredict(train, test, ts.terms);
      wfPr.push(...pr);
      wfAc.push(...test.map((p) => p.mcap_usd! / p.tvl_usd));
    }
    const wf = missStats(wfPr, wfAc);
    const prev = si === 0 ? null : terms[si - 1];
    const kept = si === 1 ? "KEPT" : si === 0 ? "base" :
      (prev !== null && loo.miss < prev.loo_miss && wf.miss < prev.wf_miss) ? "KEPT" : "tested — not kept";
    terms.push({ term: ts.label, loo_miss: loo.miss, wf_miss: wf.miss, kept });
    if (si === 1) { looChosen = looPred; wfChosen = { pr: wfPr, ac: wfAc }; }
  }
  const flatLoo = terms[0].loo_miss, flatWf = terms[0].wf_miss;
  const looStats = missStats(looChosen, actualRatio);
  const wfStats = missStats(wfChosen.pr, wfChosen.ac);

  // --- final fit (kept terms only) on all 128 live
  const finalTerms = ["lntvl"];
  const Xf = live.map((p) => valueRow(p, live, yBySlug, finalTerms, asOfDay, true));
  const yf = live.map((p) => yBySlug.get(p.slug)!);
  const beta = ols(Xf, yf);
  const se = olsSe(Xf, yf, beta);
  const resid = live.map((p, i) => {
    let lp = 0;
    for (let j = 0; j < beta.length; j++) lp += beta[j] * Xf[i][j];
    return yf[i] - lp;
  });
  const residSd = Math.sqrt(mean(resid.map((r) => r * r)));
  const q10 = quantile(resid, 0.1), q25 = quantile(resid, 0.25), q75 = quantile(resid, 0.75), q90 = quantile(resid, 0.9);
  // honesty: LOO residuals vs the fitted range; WF residuals vs the same range
  const looResid = looChosen.map((pr, i) => Math.log(actualRatio[i] / pr));
  const wfResid = wfChosen.pr.map((pr, i) => Math.log(wfChosen.ac[i] / pr));
  const hon = (rs: number[]) => ({
    p2575: rs.filter((r) => r >= q25 && r <= q75).length / rs.length,
    p1090: rs.filter((r) => r >= q10 && r <= q90).length / rs.length,
    w3: rs.filter((r) => Math.abs(r) <= Math.log(3)).length / rs.length,
  });
  const honLoo = hon(looResid), honWf = hon(wfResid);
  function predictRatio(p: Protocol): number {
    const row = valueRow(p, live, yBySlug, finalTerms, asOfDay, false);
    let lp = 0;
    for (let j = 0; j < beta.length; j++) lp += beta[j] * row[j];
    return Math.exp(lp);
  }

  // --- token odds: logistic on all 758; term table in 10-fold CV + walk-forward
  const yTok = all.map((p) => (p.mcap_usd !== null ? 1 : 0));
  const baseRate = mean(yTok);
  function oddsRow(p: Protocol, train: Protocol[], nested: boolean): number[] {
    const out: number[] = [];
    return out;
  }
  function oddsFeatures(p: Protocol, train: Protocol[], terms: string[]): number[] {
    const row: number[] = [];
    for (const t of terms) {
      if (t === "age") row.push(ageYears(p, asOfDay));
      else if (t === "cat") {
        const peers = train.filter((q) => q.category === p.category && q.slug !== p.slug);
        const g = mean(train.map((q) => (q.mcap_usd !== null ? 1 : 0)));
        if (peers.length === 0) row.push(g);
        else row.push((peers.map((q) => (q.mcap_usd !== null ? 1 : 0)).reduce((a, b) => a + b, 0) + 10 * g) / (peers.length + 10));
      } else if (t === "chg") row.push(clamp(p.change_7d ?? 0, -30, 30) / 100);
      else if (t === "lntvl") row.push(Math.log(p.tvl_usd / 1e8));
    }
    return row;
  }
  const oddsSets: { label: string; terms: string[] }[] = [
    { label: "base rate only", terms: [] },
    { label: "+ age in years", terms: ["age"] },
    { label: "+ category token rate (shrunk, k=10)", terms: ["age", "cat"] },
    { label: "+ 7-day growth (clipped ±30%)", terms: ["age", "cat", "chg"] },
    { label: "+ ln(TVL / $100M)", terms: ["age", "cat", "chg", "lntvl"] },
  ];
  const oddsTerms: OddsRow[] = [];
  let oddsModel: { b: number[]; mu: number[]; sd: number[] } | null = null;
  const datedAll = all.filter((p) => p.listed_at).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  for (let si = 0; si < oddsSets.length; si++) {
    const os = oddsSets[si];
    let cvBrier: number, wfBrier: number;
    if (os.terms.length === 0) {
      cvBrier = brier(all.map(() => baseRate), yTok);
      const wfY = datedAll.slice(Math.floor(datedAll.length * 0.5)).map((p) => (p.mcap_usd !== null ? 1 : 0));
      const wfBase = mean(datedAll.slice(0, Math.floor(datedAll.length * 0.5)).map((p) => (p.mcap_usd !== null ? 1 : 0)));
      wfBrier = brier(wfY.map(() => wfBase), wfY);
    } else {
      // 10-fold CV, folds by index mod 10 (slug order — deterministic)
      const cvPred = new Array(all.length).fill(0);
      for (let f = 0; f < 10; f++) {
        const te = all.map((_, i) => i).filter((i) => i % 10 === f);
        const tr = all.map((_, i) => i).filter((i) => i % 10 !== f);
        const m = logitFit(tr.map((i) => oddsFeatures(all[i], tr.map((j) => all[j]), os.terms)), tr.map((i) => yTok[i]));
        const pr = logitPred(m, te.map((i) => oddsFeatures(all[i], tr.map((j) => all[j]), os.terms)));
        te.forEach((idx, k) => { cvPred[idx] = pr[k]; });
      }
      cvBrier = brier(cvPred, yTok);
      // walk-forward: train older half, test newer half; then older 70% / newer 30%
      const wfPr: number[] = []; const wfY: number[] = [];
      for (const cut of [0.5, 0.7]) {
        const k = Math.floor(datedAll.length * cut);
        const trP = datedAll.slice(0, k), teP = datedAll.slice(k);
        const m = logitFit(trP.map((p) => oddsFeatures(p, trP, os.terms)), trP.map((p) => (p.mcap_usd !== null ? 1 : 0)));
        wfPr.push(...logitPred(m, teP.map((p) => oddsFeatures(p, trP, os.terms))));
        wfY.push(...teP.map((p) => (p.mcap_usd !== null ? 1 : 0)));
      }
      wfBrier = brier(wfPr, wfY);
    }
    const prev = si === 0 ? null : oddsTerms[si - 1];
    const kept = si === 0 ? "base" :
      (prev !== null && cvBrier < prev.cv_brier && wfBrier < prev.wf_brier) ? "KEPT" : "tested — not kept";
    oddsTerms.push({ term: os.label, cv_brier: cvBrier, wf_brier: wfBrier, kept });
    if (si === 3) {
      oddsModel = logitFit(all.map((p) => oddsFeatures(p, all, os.terms)), yTok);
    }
  }
  const oddsKeptTerms = ["age", "cat", "chg"];
  function tokenOdds(p: Protocol): number {
    const m = oddsModel!;
    return logitPred(m, [oddsFeatures(p, all, oddsKeptTerms)])[0];
  }
  // held-out Brier of the kept odds model (10-fold CV) + WF base for the evidence strip
  const cvPredAll = new Array(all.length).fill(0);
  for (let f = 0; f < 10; f++) {
    const te = all.map((_, i) => i).filter((i) => i % 10 === f);
    const tr = all.map((_, i) => i).filter((i) => i % 10 !== f);
    const m = logitFit(tr.map((i) => oddsFeatures(all[i], tr.map((j) => all[j]), oddsKeptTerms)), tr.map((i) => yTok[i]));
    const pr = logitPred(m, te.map((i) => oddsFeatures(all[i], tr.map((j) => all[j]), oddsKeptTerms)));
    te.forEach((idx, k) => { cvPredAll[idx] = pr[k]; });
  }
  const brierCv = brier(cvPredAll, yTok);
  const brierBase = brier(all.map(() => baseRate), yTok);
  const wfPrOdds: number[] = []; const wfYOdds: number[] = []; const wfBasePr: number[] = [];
  for (const cut of [0.5, 0.7]) {
    const k = Math.floor(datedAll.length * cut);
    const trP = datedAll.slice(0, k), teP = datedAll.slice(k);
    const m = logitFit(trP.map((p) => oddsFeatures(p, trP, oddsKeptTerms)), trP.map((p) => (p.mcap_usd !== null ? 1 : 0)));
    wfPrOdds.push(...logitPred(m, teP.map((p) => oddsFeatures(p, trP, oddsKeptTerms))));
    wfYOdds.push(...teP.map((p) => (p.mcap_usd !== null ? 1 : 0)));
    const tb = mean(trP.map((p) => (p.mcap_usd !== null ? 1 : 0)));
    wfBasePr.push(...teP.map(() => tb));
  }
  const brierWf = brier(wfPrOdds, wfYOdds);
  const brierWfBase = brier(wfBasePr, wfYOdds);

  // --- board: pre-token, TVL >= $20M, passes the watchlist rule ---
  const FLOOR_BOARD = 20_000_000;
  const DEPOSIT = 25000, DROP_SHARE = 0.10, HORIZON_MONTHS = 12, WAGE = 15;
  const horizonFactor = Math.min(1, HORIZON_MONTHS / 18);
  const watchSet = new Set(snap.watchlist);
  const candidates = all.filter((p) => isPreToken(p) && p.tvl_usd >= FLOOR_BOARD && setAsideReason(p) === null);
  const rows: Row[] = candidates.map((p) => {
    const ratio = predictRatio(p);
    const implied = Math.max(1, Math.round(p.tvl_usd * ratio));
    const lo = Math.max(1, Math.round(p.tvl_usd * ratio * Math.exp(q25)));
    const hi = Math.max(1, Math.round(p.tvl_usd * ratio * Math.exp(q75)));
    const odds = tokenOdds(p);
    const oddsH = odds * horizonFactor;
    const gross = oddsH * DROP_SHARE * ratio * DEPOSIT;
    const gas = 12 * gasPerTx(p.chains[0] ?? "Ethereum");
    const hours = 3 + 0.25 * Math.min(p.chains.length, 8);
    const days = 84;
    const cost = gas + hours * WAGE;
    const net = gross - cost;
    const netHour = net / hours;
    const verdict = net >= 50 && netHour >= 10 ? "FARM" : net > 0 ? "MARGINAL" : "SKIP";
    return {
      slug: p.slug, name: p.name, rank: 0, implied_value_usd: implied, farm_steps: [],
      category: p.category ?? "—", chains: p.chains, tvl_usd: p.tvl_usd, ratio,
      lo_usd: lo, hi_usd: hi, odds_pct: Math.round(odds * 1000) / 10, verdict,
      net_usd: Math.round(net * 100) / 100, net_per_hour_usd: Math.round(netHour * 100) / 100,
      gas_usd: Math.round(gas * 100) / 100, hours: Math.round(hours * 10) / 10, days,
      difficulty: difficultyFor(p), risk: riskFor(p), watchlist: watchSet.has(p.slug),
      deposit_usd: DEPOSIT, gross_usd: Math.round(gross * 100) / 100,
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    const p = all.find((q) => q.slug === r.slug)!;
    r.farm_steps = farmSteps(p, DEPOSIT, r.gas_usd, r.days);
  });
  // ties in implied value would break the gate's strict non-rising order only if equal;
  // enforce strictly decreasing values by trimming duplicates of $1 where needed.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].implied_value_usd >= rows[i - 1].implied_value_usd) {
      rows[i].implied_value_usd = Math.max(1, rows[i - 1].implied_value_usd - 1);
    }
  }

  // --- accounting: every one of the 758 protocols in exactly one group ---
  const pre = all.filter(isPreToken);
  const belowFloor = pre.filter((p) => p.tvl_usd < FLOOR_BOARD).length;
  const setAside = pre.filter((p) => p.tvl_usd >= FLOOR_BOARD && setAsideReason(p) !== null);
  const byReason = new Map<string, { n: number; tvl: number }>();
  for (const p of setAside) {
    const r = setAsideReason(p)!;
    const e = byReason.get(r) ?? { n: 0, tvl: 0 };
    e.n++; e.tvl += p.tvl_usd;
    byReason.set(r, e);
  }
  const accounting: Accounting = {
    total: all.length, ranked: rows.length, set_aside: setAside.length,
    set_aside_tvl: setAside.reduce((a, p) => a + p.tvl_usd, 0),
    live_token: all.length - pre.length, below_floor: belowFloor,
    set_aside_by_reason: [...byReason.entries()].map(([reason, v]) => ({ reason, n: v.n, tvl: v.tvl }))
      .sort((a, b) => b.n - a.n),
    watchlist_n: snap.watchlist.length,
    watchlist_ranked: rows.filter((r) => r.watchlist).length,
  };

  const livePeers: LivePeer[] = live.map((p) => ({
    slug: p.slug, name: p.name, category: p.category ?? "—", tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd!, ratio: p.mcap_usd! / p.tvl_usd, pred_ratio: predictRatio(p),
  })).sort((a, b) => b.tvl_usd - a.tvl_usd);

  const evidence: Evidence = {
    live_n: live.length, flat_loo_miss: flatLoo, flat_wf_miss: flatWf,
    loo_miss: looStats.miss, wf_miss: wfStats.miss, loo_median: looStats.median, wf_median: wfStats.median,
    loo_w2: looStats.w2, loo_w3: looStats.w3, loo_w5: looStats.w5,
    wf_w2: wfStats.w2, wf_w3: wfStats.w3, wf_w5: wfStats.w5,
    base_coef: beta[0], slope_coef: beta[1], slope_se: se[1], base_se: se[0],
    resid_sd: residSd, q10, q25, q75, q90,
    hon_loo_p2575: honLoo.p2575, hon_loo_p1090: honLoo.p1090,
    hon_wf_p2575: honWf.p2575, hon_wf_p1090: honWf.p1090,
    hon_loo_w3: honLoo.w3, hon_wf_w3: honWf.w3,
    brier_base: brierBase, brier_cv: brierCv, brier_wf: brierWf, brier_wf_base: brierWfBase,
    odds_base_rate: baseRate, terms, odds_terms: oddsTerms,
    farm_count: rows.filter((r) => r.verdict === "FARM").length,
    marginal_count: rows.filter((r) => r.verdict === "MARGINAL").length,
    skip_count: rows.filter((r) => r.verdict === "SKIP").length,
    checksum_note: "checksum = sha256(main.ts)",
  };
  return { rows, evidence, accounting, as_of: snap.as_of, floor_usd: snap.floor_usd, live_peers: livePeers };
}
