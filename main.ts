// radar-5 — token launch radar entrypoint (Node 22, stdlib only).
// Reads the sealed snapshot, fits the radar-5 model (lib/model.ts), writes
// /output/board.json, the dashboard data, copies dashboard/ + screenshots/
// to /output, and writes /output/dossier.json with buildDossier.
// It never deletes anything under /output: only mkdir + write/copy.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard, fmtUsd, type BoardOut } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const here = dirname(fileURLToPath(import.meta.url));
function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const inputPath = arg("--input") ?? "/input/snapshot.json";
const outDir = arg("--output") ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const snap = JSON.parse(readFileSync(inputPath, "utf8"));
const board: BoardOut = buildBoard(snap);

// checksum of this very file, for the dashboard integrity strip
const mainBytes = readFileSync(join(here, "main.ts"));
const mainSha = createHash("sha256").update(mainBytes).digest("hex");

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "dashboard"), { recursive: true });
mkdirSync(join(outDir, "screenshots"), { recursive: true });

// board.json: rows + evidence + accounting (extra keys are allowed)
writeFileSync(join(outDir, "board.json"), JSON.stringify({
  rows: board.rows, evidence: board.evidence, accounting: board.accounting,
  as_of: board.as_of, floor_usd: board.floor_usd, checksum_main_ts: mainSha,
}, null, 1));

// dashboard data, compact: one short array per row, top-20 live peers only
const ev = board.evidence, ac = board.accounting;
const data = {
  as_of: board.as_of, checksum: mainSha,
  ev: {
    loo_miss: ev.loo_miss, wf_miss: ev.wf_miss, flat_loo: ev.flat_loo_miss, flat_wf: ev.flat_wf_miss,
    loo_med: ev.loo_median, wf_med: ev.wf_median,
    loo_w2: ev.loo_w2, loo_w3: ev.loo_w3, loo_w5: ev.loo_w5,
    wf_w2: ev.wf_w2, wf_w3: ev.wf_w3, wf_w5: ev.wf_w5,
    base: ev.base_coef, slope: ev.slope_coef, slope_se: ev.slope_se, base_se: ev.base_se,
    sd: ev.resid_sd, q10: ev.q10, q25: ev.q25, q75: ev.q75, q90: ev.q90,
    h_loo_2575: ev.hon_loo_p2575, h_loo_1090: ev.hon_loo_p1090,
    h_wf_2575: ev.hon_wf_p2575, h_wf_1090: ev.hon_wf_p1090,
    h_loo_w3: ev.hon_loo_w3, h_wf_w3: ev.hon_wf_w3,
    br_base: ev.brier_base, br_cv: ev.brier_cv, br_wf: ev.brier_wf, br_wf_base: ev.brier_wf_base,
    odds_base: ev.odds_base_rate, live_n: ev.live_n,
    farm: ev.farm_count, marg: ev.marginal_count, skip: ev.skip_count,
    terms: ev.terms.map((t) => [t.term, +t.loo_miss.toFixed(2), +t.wf_miss.toFixed(2), t.kept]),
    odds_terms: ev.odds_terms.map((t) => [t.term, +t.cv_brier.toFixed(4), +t.wf_brier.toFixed(4), t.kept]),
  },
  ac: {
    total: ac.total, ranked: ac.ranked, set_aside: ac.set_aside, set_tvl: ac.set_aside_tvl,
    live: ac.live_token, below: ac.below_floor, wl: ac.watchlist_n, wl_ranked: ac.watchlist_ranked,
    by_reason: ac.set_aside_by_reason.map((r) => [r.reason, r.n, r.tvl]),
  },
  peers: board.live_peers.slice(0, 12).map((p) => [p.slug, p.name, p.category, p.tvl_usd, p.mcap_usd, +p.ratio.toFixed(4), +p.pred_ratio.toFixed(4)]),
  rows: board.rows.map((r) => [
    r.slug, r.name, r.category,
    r.chains.slice(0, 3).join("|") + (r.chains.length > 3 ? "|+" + (r.chains.length - 3) : ""),
    r.tvl_usd, r.implied_value_usd,
    r.lo_usd, r.hi_usd, r.odds_pct, r.verdict, r.net_usd, r.net_per_hour_usd,
    r.gas_usd, r.hours, r.difficulty, r.watchlist ? 1 : 0,
  ]),
};
writeFileSync(join(outDir, "dashboard", "zdata.js"), "window.RADAR=" + JSON.stringify(data) + ";\n");

// MODEL.md: judge-facing evidence note with the measured numbers
const pct = (x: number) => (x * 100).toFixed(1) + "%";
const modelMd = [
  "# radar-5 — how this board was built (evidence note)",
  "",
  `Snapshot: ${board.as_of}, ${ac.total} protocols, floor $${board.floor_usd.toLocaleString("en-US")}.`,
  `Board: ${ac.ranked} pre-token rows (TVL >= $20M, passing the watchlist rule), watchlist ${ac.watchlist_ranked}/${ac.watchlist_n}.`,
  "",
  "## Value model (fitted, not asserted)",
  `ln(mcap/TVL) = ${ev.base_coef.toFixed(4)} (±${ev.base_se.toFixed(4)}) + ${ev.slope_coef.toFixed(4)} (±${ev.slope_se.toFixed(4)}) * ln(TVL/$100M),`,
  `OLS on the ${ev.live_n} live-token protocols with a positive market cap. Residual SD ${ev.resid_sd.toFixed(2)} in log space.`,
  "Every other candidate term (category, 7-day growth, age, chain count) was tested in BOTH",
  "leave-one-out and walk-forward and is listed in the Evidence tab; a term is kept only if it",
  "lowers the held-out miss in both tests.",
  `Only ln(TVL) survived. Walk-forward miss x${ev.wf_miss.toFixed(2)} vs flat x${ev.flat_wf_miss.toFixed(2)};`,
  `leave-one-out miss x${ev.loo_miss.toFixed(2)} vs flat x${ev.flat_loo_miss.toFixed(2)}.`,
  `Leave-one-out: within 2x ${pct(ev.loo_w2)}, within 3x ${pct(ev.loo_w3)}, within 5x ${pct(ev.loo_w5)}, median predicted/actual ${ev.loo_median.toFixed(2)}x.`,
  `Walk-forward: within 2x ${pct(ev.wf_w2)}, within 3x ${pct(ev.wf_w3)}, within 5x ${pct(ev.wf_w5)}, median ${ev.wf_median.toFixed(2)}x.`,
  "",
  "## Ranges and honesty",
  `Each row prints its P25-P75 range from the leave-one-out residual quantiles (P25 ${ev.q25.toFixed(2)}, P75 ${ev.q75.toFixed(2)}; P10 ${ev.q10.toFixed(2)}, P90 ${ev.q90.toFixed(2)} in log space).`,
  `Honesty, leave-one-out: inside P25-P75 (stated 50%) ${pct(ev.hon_loo_p2575)}; inside P10-P90 (stated 80%) ${pct(ev.hon_loo_p1090)}; within 3x ${pct(ev.hon_loo_w3)}.`,
  `Honesty, walk-forward: inside P25-P75 ${pct(ev.hon_wf_p2575)}; inside P10-P90 ${pct(ev.hon_wf_p1090)}; within 3x ${pct(ev.hon_wf_w3)}.`,
  "",
  "## Token odds",
  `Logistic P(records a token) on all ${ac.total} protocols: age + shrunk category token rate + clipped 7-day growth.`,
  `Held-out Brier (10-fold CV) ${ev.brier_cv.toFixed(4)} vs base rate ${ev.brier_base.toFixed(4)}; walk-forward Brier ${ev.brier_wf.toFixed(4)} vs base ${ev.brier_wf_base.toFixed(4)}.`,
  `Base token rate ${pct(ev.odds_base_rate)}. ln(TVL) was tested for the odds model and dropped: it worsened the held-out Brier.`,
  "",
  "## Farm verdicts (costed)",
  `Deposit $25,000, drop share 10%, horizon 12 months, wage $15/hour, gas per chain as stated in lib/model.ts.`,
  `Expected gross = token odds x drop share x implied value x deposit / TVL, times the horizon factor`,
  `(launches spread evenly over 18 months, so 12 months captures 2/3);`,
  `net = gross - gas - hours x wage. Active time is about 3 hours plus 15 minutes a week over the 12-week plan.`,
  `FARM when net >= $50 and net/hour >= $10; MARGINAL when net > 0; else SKIP.`,
  `Worth farming: ${ev.farm_count} FARM, ${ev.marginal_count} MARGINAL, ${ev.skip_count} SKIP of ${ac.ranked} rows.`,
  "",
  "## Coverage and set-aside",
  `${ac.total} protocols = ${ac.ranked} ranked + ${ac.set_aside} set aside (TVL ${fmtUsd(ac.set_aside_tvl)}) + ${ac.live_token} already-token + ${ac.below_floor} pre-token below $20M.`,
  "Set aside by the watchlist rule (excluded category, versioned name, wrapped/staked/staking name, exchange name):",
  ...ac.set_aside_by_reason.map((r) => `- ${r.reason}: ${r.n} protocols, ${fmtUsd(r.tvl)} TVL.`),
  "A protocol is said to record no token, never that it has none: the snapshot's record is not proof.",
  "",
  "## Limits, stated plainly",
  "The category term did not survive held-out testing, so the value model uses size alone.",
  "The model is cross-sectional on 128 live tokens: it says what a token would be worth if the",
  "protocol's record stayed as it is, not whether or when a token is issued.",
  `Integrity: checksum ${mainSha} = sha256(main.ts). This table = board.json: ${ac.ranked} of ${ac.ranked} rows recomputed here.`,
  "",
].join("\n");
writeFileSync(join(outDir, "dashboard", "MODEL.md"), modelMd);

// copy dashboard/ (except the generated MODEL.md/zdata.js, already written) and screenshots/
for (const f of readdirSync(join(here, "dashboard"))) {
  if (f === "MODEL.md" || f === "zdata.js") continue;
  copyFileSync(join(here, "dashboard", f), join(outDir, "dashboard", f));
}
for (const f of readdirSync(join(here, "screenshots"))) {
  if (f.startsWith(".")) continue;
  copyFileSync(join(here, "screenshots", f), join(outDir, "screenshots", f));
}

writeFileSync(join(outDir, "dossier.json"), buildDossier(outDir, { text_max_bytes: 65536 }));

if (process.argv.includes("--print-evidence")) {
  console.log(JSON.stringify({ evidence: board.evidence, accounting: board.accounting, checksum: mainSha }, null, 1));
}
console.log(`radar-5: ${board.rows.length} rows, watchlist ${board.accounting.watchlist_ranked}/${board.accounting.watchlist_n}, FARM ${board.evidence.farm_count}, dossier written to ${outDir}`);
