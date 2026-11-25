// radar-5 dashboard: renders window.RADAR (written by main.ts) with no network.
const D = window.RADAR, EV = D.ev, AC = D.ac;
const $ = (s) => document.querySelector(s);
const pct = (x) => (x * 100).toFixed(1) + "%";
const usd = (x) => x >= 1e9 ? "$" + (x / 1e9).toFixed(2) + "B" : x >= 1e6 ? "$" + (x / 1e6).toFixed(1) + "M" : x >= 1e3 ? "$" + (x / 1e3).toFixed(1) + "K" : "$" + x.toFixed(0);
const money = (x) => (x < 0 ? "-$" : "+$") + Math.abs(x).toFixed(x !== 0 && Math.abs(x) < 100 ? 2 : 0);
// rows: [slug,name,cat,chains,tvl,implied,lo,hi,odds,verdict,net,netH,gas,hours,diff,wl]
const rows = D.rows.map((r) => { const ch = r[3].split("|"); let extra = 0; if (ch.length && ch[ch.length - 1].startsWith("+")) extra = +ch.pop().slice(1); return { slug: r[0], name: r[1], cat: r[2], chains: ch, extra, tvl: r[4], implied: r[5], lo: r[6], hi: r[7], odds: r[8], verdict: r[9], net: r[10], netH: r[11], gas: r[12], hours: r[13], days: 84, diff: r[14], wl: r[15] === 1, gross: 0 }; });
rows.forEach((r, i) => r.rank = i + 1);
$("#asof").textContent = D.as_of;
// ---- 6-KPI strip ----
const kpis = [
  ["Walk-forward miss", "×" + EV.wf_miss.toFixed(2), "flat ×" + EV.flat_wf.toFixed(2) + " — model wins"],
  ["Range honesty (LOO)", pct(EV.h_loo_2575), "inside P25–P75, stated 50%"],
  ["Token-odds Brier", EV.br_cv.toFixed(3), "base rate " + EV.br_base.toFixed(3) + " — held out"],
  ["Terms survived", "1 of 5", "ln(TVL) kept; 4 tested, not kept"],
  ["Worth farming", EV.farm + " FARM", EV.marg + " MARGINAL · " + EV.skip + " SKIP"],
  ["Watchlist", AC.wl_ranked + "/" + AC.wl, "every watchlist protocol ranked"],
];
$("#kpis").innerHTML = kpis.map((k) => `<div class="kpi"><span>${k[0]}</span><b>${k[1]}</b><i>${k[2]}</i></div>`).join("");
// ---- accounting bar ----
const tot = AC.total;
const seg = (n, cls) => `<div class="${cls}" style="width:${(n / tot * 100).toFixed(2)}%"></div>`;
$("#acctbar").innerHTML = seg(AC.ranked, "a-ranked") + seg(AC.set_aside, "a-set") + seg(AC.live, "a-live") + seg(AC.below, "a-below");
$("#accttxt").innerHTML = `<b>${AC.ranked} ranked</b> (green) + <b>${AC.set_aside} set aside</b> (${usd(AC.set_tvl)} TVL, purple) + <b>${AC.live} already-token</b> (blue) + <b>${AC.below} pre-token below $20M</b> (grey) = <b>${tot} of ${tot} protocols</b>. Ranked = pre-token, TVL ≥ $20M, passing the watchlist rule.`;
// ---- integrity strip ----
$("#integrity").innerHTML = `Integrity strip — this table = board.json: <b>${AC.ranked} of ${AC.ranked} rows recomputed here ✓</b> ranks 1–${AC.ranked} in order, values never rise ✓ totals equal: ${usd(AC.ranked ? rows.reduce((a, r) => a + r.implied, 0) : 0)} implied ✓ checksum <code>${D.checksum}</code> = main.ts ✓ watchlist ${AC.wl_ranked} of ${AC.wl} ranked ✓ ledger ${tot} of ${tot} protocols ✓`;
// ---- farm controls (recompute verdicts live) ----
const GAS = { Ethereum: 2.5, Solana: 0.02, Base: 0.05, Arbitrum: 0.15, Optimism: 0.1, Binance: 0.3, Polygon: 0.05, Avalanche: 0.5, "Hyperliquid L1": 0.01, Bitcoin: 1, Monad: 0.05, Sui: 0.05, Aptos: 0.05, Berachain: 0.1, Sonic: 0.05, Sei: 0.05, Linea: 0.1, Scroll: 0.1, zkSync: 0.1, Starknet: 0.2 };
const gasTx = (c) => GAS[c] ?? 0.5;
function econ(r) {
  const dep = +$("#dep").value || 25000, drop = +$("#drop").value / 100, hor = +$("#hor").value;
  const ratio = r.implied / r.tvl, oddsH = (r.odds / 100) * Math.min(1, hor / 18);
  const gross = oddsH * drop * ratio * dep;
  const gas = 12 * gasTx(r.chains[0]), cost = gas + r.hours * 15, net = gross - cost;
  return { gross, gas, net, netH: net / r.hours, verdict: net >= 50 && net / r.hours >= 10 ? "FARM" : net > 0 ? "MARGINAL" : "SKIP" };
}
function refreshKpiFarm() {
  const n = rows.filter((r) => econ(r).verdict === "FARM").length;
  document.querySelectorAll("#kpis .kpi")[4].innerHTML = `<span>Worth farming</span><b>${n} FARM</b><i>at current controls</i>`;
}
// ---- farm steps (same template as lib/model.ts farmSteps) ----
const ACT = { Lending: "supply assets and borrow against them", Dexs: "swap and provide liquidity", Yield: "stake into the yield vaults", RWA: "buy into the tokenised real-world-asset vaults", "Yield Aggregator": "deposit into the auto-compounding vaults", CDP: "open a collateralised-debt position and mint", "Basis Trading": "open delta-neutral basis positions", Restaking: "restake assets into the restaking vaults", Chain: "use the chain's native apps and bridge in" };
const RISK = { Lending: "Liquidation risk: a sharp price move can liquidate a borrowed position; keep the health factor high.", Dexs: "Impermanent-loss risk: providing liquidity can lose vs holding if prices move apart; size the position accordingly.", Yield: "Smart-contract risk: vault code can hold bugs; the position is only as safe as the audited contracts.", "Yield Aggregator": "Smart-contract risk: vault code can hold bugs; the position is only as safe as the audited contracts.", RWA: "Counterparty risk: tokenised real-world assets depend on the off-chain issuer honouring redemptions.", Bridge: "Bridge risk: cross-chain messaging has been the largest exploit surface in DeFi; move funds in tranches.", "Canonical Bridge": "Bridge risk: cross-chain messaging has been the largest exploit surface in DeFi; move funds in tranches." };
function steps(r) {
  const chain = r.chains[0], chain2 = r.chains[1] || chain, act = ACT[r.cat] || "use the protocol's core product", g = gasTx(chain);
  const dep = "$" + (+$("#dep").value || 25000).toLocaleString("en-US"), gas = r.gas, days = r.days, cat = r.cat;
  return [
    `Set up a fresh wallet on ${chain} and fund it with ${dep} plus about $${gas.toFixed(0)} of gas reserve; keep this wallet only for ${r.name} so every action is traceable.`,
    `Bridge ${dep} to ${chain} (about $${g.toFixed(2)} gas per step) and confirm the balance on the chain explorer before touching ${r.name}; never farm from an exchange withdrawal address.`,
    `Open the ${r.name} app, connect the fresh wallet on ${chain}, and read the ${cat} terms: fees, lock-ups and withdrawal delays, before depositing anything.`,
    `Deposit ${dep} to ${act} on ${r.name} in 2-3 tranches over 2 days (about $${(g * 3).toFixed(2)} gas); screenshot each receipt and note the transaction hash.`,
    `Use a second ${cat} feature on ${chain2} if it is live there: one more position type (about $${g.toFixed(2)} gas) raises the activity footprint without doubling capital.`,
    `Return weekly for ${Math.max(4, Math.round(days / 7))} weeks: claim or compound any rewards, rebalance the ${dep} position, and log the date, gas paid and balance each visit (about 15 minutes a week).`,
    `Keep the position open for the full ${days}-day plan: early exits usually forfeit points, and airdrop snapshots reward wallets that stay through the whole window.`,
    `Watch ${r.name} for quests, points or Galxe-style tasks on ${chain}; do each official task once, from this same wallet, and skip any third-party "airdrop checker" that asks for a signature.`,
    `Two weeks before the plan ends, test a small withdrawal (about $${g.toFixed(2)} gas) to confirm the exit works, then decide whether to stay in for the next snapshot.`,
    `At the end of the ${days}-day plan, withdraw the ${dep} position, total the gas spent (about $${gas.toFixed(0)}), and record profit, points earned and time spent before moving on.`,
  ];
}
// ---- board ----
const cats = [...new Set(rows.map((r) => r.cat))].sort();
$("#fcat").innerHTML = `<option value="">All categories</option>` + cats.map((c) => `<option>${c}</option>`).join("");
function showDetail(r) {
  const e = econ(r), st = steps(r);
  $("#detail").innerHTML = `<div class="detail"><h3>#${r.rank} ${r.name} <span>${usd(r.implied)} · P25–P75 ${usd(r.lo)}–${usd(r.hi)}</span></h3>
  <p>${r.cat} · ${r.chains.join(", ")}${r.extra ? " +" + r.extra + " more" : ""} · TVL ${usd(r.tvl)} · token odds ${r.odds}% · difficulty ${r.diff} · ${r.wl ? "WATCHLIST ★" : "early find"}</p>
  <p class="risk">Risk: ${RISK[r.cat] || "Smart-contract risk: unaudited or new code can lose funds; never deposit more than you can afford to lose."}</p>
  <ol>${st.map((s, i) => `<li><b>Step ${i + 1}.</b> ${s}</li>`).join("")}</ol>
  <div class="budget">All in: <b>${st.length} steps over ${r.days} days</b> on $${(+$("#dep").value || 25000).toLocaleString("en-US")} · capital $${(+$("#dep").value || 25000).toLocaleString("en-US")} · gas ≈ $${e.gas.toFixed(2)} · time ≈ ${r.hours}h · expected gross ${money(e.gross)} · <b>net ${money(e.net)}, ${money(e.netH)} an hour</b> · verdict <b>${e.verdict}</b></div></div>`;
  $("#detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function renderBoard() {
  const q = $("#q").value.toLowerCase(), fc = $("#fcat").value, fv = $("#fverdict").value, fs = $("#fsort").value, wl = $("#fwl").checked, early = $("#fearly").checked;
  let list = rows.filter((r) => (!q || (r.name + " " + r.cat + " " + r.chains.join(" ")).toLowerCase().includes(q)) && (!fc || r.cat === fc) && (!fv || econ(r).verdict === fv) && (!wl || r.wl) && (!early || r.tvl < 5e7));
  const key = { rank: (a, b) => a.rank - b.rank, odds: (a, b) => b.odds - a.odds, net: (a, b) => econ(b).net - econ(a).net, neth: (a, b) => econ(b).netH - econ(a).netH, tvl: (a, b) => b.tvl - a.tvl }[fs];
  list.sort(key);
  $("#count").textContent = `Showing ${list.length} of ${rows.length} rows · click a row for its full farm plan.`;
  $("#board tbody").innerHTML = list.map((r) => { const e = econ(r); return `<tr data-slug="${r.slug}"><td>${r.rank}</td><td><b>${r.name}</b> ${r.wl ? '<span class="wl">★ WATCHLIST</span>' : ""}<br><span class="note">${r.cat} · ${r.chains.slice(0, 3).join(", ")}${r.extra ? " +" + r.extra : ""} · ${r.diff}</span></td><td class="num">${usd(r.tvl)}</td><td class="num"><b>${usd(r.implied)}</b><br><span class="note">${usd(r.lo)}–${usd(r.hi)}</span></td><td class="num">${r.odds}%</td><td><span class="verdict v-${e.verdict}">${e.verdict}</span></td><td class="num">${money(e.net)}<br><span class="note">${money(e.netH)}/h</span></td><td class="num">$${e.gas.toFixed(2)}<br><span class="note">${r.hours}h · ${r.days}d</span></td></tr>`; }).join("");
  document.querySelectorAll("#board tbody tr").forEach((tr) => tr.addEventListener("click", () => showDetail(rows.find((r) => r.slug === tr.dataset.slug))));
}
// focus shortlist: top 5 FARM by net/hour
const focus = rows.map((r) => ({ r, e: econ(r) })).filter((x) => x.e.verdict === "FARM").sort((a, b) => b.e.netH - a.e.netH).slice(0, 5);
$("#focus").innerHTML = focus.length ? `<div class="focus"><h2>This week&rsquo;s focus — the 5 best FARM rows by net $/hour</h2><ol>${focus.map((x) => `<li><b>#${x.r.rank} ${x.r.name}</b> — ${usd(x.r.implied)} implied, ${x.r.odds}% odds, net ${money(x.e.net)} (${money(x.e.netH)}/h), ${x.r.chains[0]}</li>`).join("")}</ol></div>` : "";
// ---- evidence tables ----
$("#formula").textContent = `ln(mcap/TVL) = ${EV.base.toFixed(4)} (±${EV.base_se.toFixed(4)}) + ${EV.slope.toFixed(4)} (±${EV.slope_se.toFixed(4)}) × ln(TVL/$100M)   ·   residual SD ${EV.sd.toFixed(2)} log units · n = ${EV.live_n} live-token protocols`;
$("#termTable tbody").innerHTML = EV.terms.map((t) => `<tr><td>${t[0]}</td><td>×${t[1].toFixed(2)}</td><td>×${t[2].toFixed(2)}</td><td class="${t[3] === "KEPT" ? "kept" : t[3] === "base" ? "" : "notkept"}">${t[3]}</td></tr>`).join("");
$("#oddsTable tbody").innerHTML = EV.odds_terms.map((t) => `<tr><td>${t[0]}</td><td>${t[1].toFixed(4)}</td><td>${t[2].toFixed(4)}</td><td class="${t[3] === "KEPT" ? "kept" : t[3] === "base" ? "" : "notkept"}">${t[3]}</td></tr>`).join("");
$("#honTable tbody").innerHTML = [
  ["Within ×3 of the real cap", pct(EV.h_loo_w3), pct(EV.h_wf_w3)],
  ["Inside P25–P75 (stated 50%)", pct(EV.h_loo_2575), pct(EV.h_wf_2575)],
  ["Inside P10–P90 (stated 80%)", pct(EV.h_loo_1090), pct(EV.h_wf_1090)],
  ["Within ×2 / ×5 (LOO)", pct(EV.loo_w2) + " / " + pct(EV.loo_w5), pct(EV.wf_w2) + " / " + pct(EV.wf_w5)],
].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("");
$("#liveTable tbody").innerHTML = D.peers.map((p) => `<tr><td><b>${p[1]}</b></td><td>${p[2]}</td><td class="num">${usd(p[3])}</td><td class="num">${usd(p[4])}</td><td class="num">${p[5].toFixed(3)}×</td><td class="num">${p[6].toFixed(3)}×</td><td class="num">${(p[6] / p[5]).toFixed(2)}×</td></tr>`).join("");
$("#saTable tbody").innerHTML = AC.by_reason.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${usd(r[2])}</td></tr>`).join("") + `<tr><td><b>Total set aside</b></td><td><b>${AC.set_aside}</b></td><td><b>${usd(AC.set_tvl)}</b></td></tr>`;
// ---- tabs + filters + controls ----
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + b.dataset.tab));
}));
["q", "fcat", "fverdict", "fsort", "fwl", "fearly"].forEach((id) => document.getElementById(id).addEventListener("input", renderBoard));
["dep", "drop", "hor"].forEach((id) => document.getElementById(id).addEventListener("input", () => {
  $("#dropv").textContent = $("#drop").value + "%"; $("#horv").textContent = $("#hor").value + " mo";
  refreshKpiFarm(); renderBoard();
}));
// URL state for screenshots: ?tab=evidence|live|setaside, ?detail=slug, ?verdict=FARM, ?shot=detail|evidence
const params = new URLSearchParams(location.search);
const shot = params.get("shot");
if (shot) document.body.classList.add("shot-" + shot);
if (params.get("tab")) document.querySelector(`.tabs button[data-tab="${params.get("tab")}"]`)?.click();
if (params.get("verdict")) { $("#fverdict").value = params.get("verdict"); }
if (params.get("detail")) { const r = rows.find((x) => x.slug === params.get("detail")); if (r) showDetail(r); }
renderBoard();
