// Token Radar, model radar-4 — the dashboard.
//
// Reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, five tabs, a per-protocol detail view, and a side-by-side
// comparison. No network: every byte it shows is in data.js.
//
// The page does not trust the board's numbers: impliedOf() below recomputes
// a row's implied value from the snapshot's own figures — the live-token
// table for the category multiple, the row's TVL, seven-day change, age,
// chains and category share for the factors — and the detail view shows the
// recomputation beside the number board.json carries, so the screenshots and
// the code visibly agree. The farm plans come from data.js, written by the
// same derivation main.ts puts in board.json, so the page and the board can
// never drift apart.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { tab: 'board', q: '', category: 'all', chain: 'all', watch: false, early: false, sort: 'implied', dir: -1, selected: null, compare: [] };

  // ------------------------------------------------------------ formatting

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + '×';
  }
  function fmtFactor(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(4);
  }

  // ------------------------------------------------- the model, recomputed
  // The live tokens' log-ratios, grouped by category, cached once. The
  // multiple for a category is the geometric mean of its live tokens'
  // market-cap-per-TVL, shrunk toward the global geometric mean with a
  // hierarchical prior of strength k: exp((n*mean_log_cat + k*mean_log_all)
  // / (n + k)), clamped to [0.02, 3]. A category with no live token scores
  // the global multiple exactly.
  var LOGS = {};
  var GLOBAL_LOG_MEAN = 0;
  (function buildLogs() {
    var sum = 0;
    var count = 0;
    DATA.live.forEach(function (p) {
      var lr = Math.log(p.mcap_usd / p.tvl_usd);
      var c = p.category || 'Other';
      if (!LOGS[c]) LOGS[c] = [];
      LOGS[c].push(lr);
      sum += lr;
      count++;
    });
    GLOBAL_LOG_MEAN = count ? sum / count : 0;
  })();
  function multipleFor(category) {
    var m = DATA.model;
    var cat = LOGS[category || 'Other'] || [];
    var n = cat.length;
    var centre = n ? cat.reduce(function (a, b) { return a + b; }, 0) / n : GLOBAL_LOG_MEAN;
    var v = Math.exp((n * centre + m.shrinkage_k * GLOBAL_LOG_MEAN) / (n + m.shrinkage_k));
    return Math.min(m.multiple_cap, Math.max(m.multiple_floor, v));
  }
  // Every factor of one row, from the snapshot's own figures and the model
  // constants data.js carries. This is the same arithmetic lib/model.ts
  // runs; the detail view compares its result with board.json's number.
  function impliedParts(row) {
    var m = DATA.model;
    var mult = multipleFor(row.category);
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growth = Math.pow(1 + g / 100, m.growth_exponent);
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(age, m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chains = (row.chains || []).length;
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max(chains - 1, 0), m.breadth_max_chains);
    var catTvl = DATA.cat_tvl[row.category || 'Other'] || row.tvl_usd;
    var dominance = 1 + m.dominance_weight * (row.tvl_usd / catTvl);
    var sizeRaw = Math.exp(m.size_slope * (Math.log(row.tvl_usd) - m.size_centre_log_tvl));
    var size = Math.min(m.size_cap, Math.max(m.size_floor, sizeRaw));
    var implied = Math.max(1, Math.round(row.tvl_usd * mult * growth * maturity * breadth * dominance * size));
    return { multiple: mult, growth: growth, maturity: maturity, breadth: breadth, dominance: dominance, size: size, implied: implied };
  }

  // ------------------------------------------------------------- filtering

  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.early && !r.early) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'ratio') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function filtersActive() {
    return state.q.trim() !== '' || state.category !== 'all' || state.chain !== 'all' || state.watch || state.early;
  }

  // ------------------------------------------------------------- hash links
  // #t=<tab> &p=<slug> &c=<category> &ch=<chain> &w=1 &e=1 &q=<text>
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('t')) state.tab = params.get('t');
    if (params.get('q')) state.q = params.get('q');
    if (params.get('c')) state.category = params.get('c');
    if (params.get('ch')) state.chain = params.get('ch');
    if (params.get('w')) state.watch = true;
    if (params.get('e')) state.early = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.tab !== 'board') params.set('t', state.tab);
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('c', state.category);
    if (state.chain !== 'all') params.set('ch', state.chain);
    if (state.watch) params.set('w', '1');
    if (state.early) params.set('e', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ----------------------------------------------------------------- views

  function masthead() {
    return '<header class="masthead">' +
      '<span class="brand">Token <i>Radar</i></span>' +
      '<span class="tagline">Which pre-token protocol is worth farming next — and what to do about it.</span>' +
      '<div class="meta"><span>Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
      '<span>Model <b>' + esc(DATA.model_version) + '</b></span>' +
      '<span>DefiLlama protocol index</span></div></header>';
  }

  function lede() {
    return '<section class="lede"><div>' +
      '<h1>' + DATA.watchlist_size + ' watchlist protocols covered, ' + DATA.board_size + ' pre-token rows ranked by implied value</h1>' +
      '<p>The watchlist is the floor, never the ceiling: every protocol with at least ' + fmtUsd(DATA.floor_usd) + ' of TVL and no token on record, plus ' + DATA.early_size + ' early finds below it. Implied value is a model, not a promise — and never a prediction that a token launches.</p></div>' +
      '<div class="facts">' +
      '<div class="fact"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><small>every slug on the list</small></div>' +
      '<div class="fact"><span>Total implied value</span><b>' + fmtUsd(DATA.total_implied_usd) + '</b><small>across ' + DATA.board_size + ' rows</small></div>' +
      '<div class="fact"><span>Early finds</span><b>' + DATA.early_size + '</b><small>below the ' + fmtUsd(DATA.floor_usd) + ' floor</small></div>' +
      '<div class="fact"><span>Set aside</span><b>' + DATA.set_aside_size + '</b><small>' + fmtUsd(DATA.set_aside_tvl_usd) + ' TVL, listed not ranked</small></div>' +
      '</div></section>';
  }

  var TABS = [
    ['board', 'Board'],
    ['focus', "This week's focus"],
    ['live', 'Live tokens'],
    ['model', 'How it scores'],
    ['setaside', 'Set aside'],
  ];
  function tabsBar() {
    var h = '<nav class="tabs" role="tablist">';
    TABS.forEach(function (t) {
      h += '<button type="button" role="tab" aria-selected="' + (state.tab === t[0] ? 'true' : 'false') + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    });
    if (state.tab === 'compare') h += '<button type="button" role="tab" aria-selected="true" data-act="tab" data-tab="compare">Compare</button>';
    if (state.compare.length === 2) {
      var a = bySlug(state.compare[0]);
      var b = bySlug(state.compare[1]);
      h += '<span class="cmp-note">' + esc(a ? a.name : '') + ' vs ' + esc(b ? b.name : '') +
        '<button type="button" data-act="tab" data-tab="compare">Compare</button></span>';
    } else if (state.compare.length === 1) {
      h += '<span class="cmp-note">1 protocol picked for comparison — tick one more row.</span>';
    }
    return h + '</nav>';
  }

  function focusStrip() {
    if (filtersActive()) return '';
    var cards = DATA.focus.slice(0, 4).map(function (f, i) {
      return '<button type="button" class="focus-card" data-act="open" data-slug="' + esc(f.slug) + '">' +
        '<span class="rk">Focus ' + (i + 1) + ' · rank ' + f.rank + '</span><b>' + esc(f.name) + '</b>' +
        '<span>' + esc(f.reason) + '</span></button>';
    }).join('');
    return '<div class="focus-strip">' + cards + '</div>' +
      '<p class="sub" style="margin:-6px 0 12px">This week&rsquo;s focus: the eight highest-valued rows whose TVL grew in the last 7 days, ranked by implied value &times; growth. <a href="#" data-act="tab" data-tab="focus">See all eight</a>.</p>';
  }

  function controls(count) {
    var cats = {};
    DATA.rows.forEach(function (r) { cats[r.category || 'Other'] = true; });
    var catOpts = '<option value="all">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chains = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = true; }); });
    var chainOpts = '<option value="all">All chains</option>' + Object.keys(chains).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    return '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + catOpts + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain">' + chainOpts + '</select></div>' +
      '<div class="toggles">' +
      '<button type="button" class="toggle" aria-pressed="' + (state.watch ? 'true' : 'false') + '" data-act="toggle-watch">Watchlist only</button>' +
      '<button type="button" class="toggle" aria-pressed="' + (state.early ? 'true' : 'false') + '" data-act="toggle-early">Early finds only</button>' +
      (filtersActive() ? '<button type="button" class="toggle" data-act="clear">Clear filters</button>' : '') +
      '</div>' +
      '<span class="count"><b>' + count + '</b> rows shown of ' + DATA.board_size + '</span></div>';
  }

  function sortHead(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return '<th scope="col"><button type="button" data-act="sort" data-sort="' + key + '">' + label + arrow + '</button></th>';
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var h = controls(list.length);
    if (list.length === 0) {
      return h + '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button class="button" type="button" data-act="clear">Clear filters</button></div></div>';
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var rows = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var gClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var checked = state.compare.indexOf(r.slug) >= 0 ? ' checked' : '';
      var badge = r.watchlist ? '<span class="badge">Watchlist</span>' : '<span class="badge early">Early</span>';
      var pct = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug ? 'true' : 'false') + '" tabindex="0">' +
        '<td><input type="checkbox" class="cmpbox" aria-label="Compare ' + esc(r.name) + '"' + checked + ' data-slug="' + esc(r.slug) + '"></td>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b>' + badge +
        '<span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + gClass + '">' + growth + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span><span class="num">' + fmtUsd(r.implied_value_usd) + '</span></td>' +
        '<td class="num">' + fmtMult(r.implied_value_usd / r.tvl_usd) + '</td>' +
        '</tr>';
    }).join('');
    return h + '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Pre-token protocols, strongest implied value first. Select a row for its model and farm plan; tick two rows to compare them.</caption>' +
      '<thead><tr><th scope="col" title="Compare">☐</th>' +
      sortHead('implied', 'Rank') + sortHead('name', 'Protocol') + sortHead('tvl', 'TVL') + sortHead('growth', '7d') +
      sortHead('age', 'Age') + sortHead('implied', 'Implied value') + sortHead('ratio', 'Value / TVL') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="foot">Implied value is the radar-4 model&rsquo;s claim, never a price. Value / TVL is the implied value per dollar of TVL — the board&rsquo;s efficiency sort.</p></div>';
  }

  // ------------------------------------------------------------ focus tab

  function focusView() {
    var cards = DATA.focus.map(function (f, i) {
      var row = bySlug(f.slug);
      return '<button type="button" class="focus-card" data-act="open" data-slug="' + esc(f.slug) + '">' +
        '<span class="rk">Focus ' + (i + 1) + ' · rank ' + f.rank + ' of ' + DATA.board_size + '</span><b>' + esc(f.name) + '</b>' +
        '<span>' + esc(f.category || 'Other') + ' · ' + esc(f.reason) + '</span>' +
        (row ? '<span>Farm: $' + row.farm_summary.capital_usd + ' capital, ~$' + row.farm_summary.gas_usd + ' gas, ' + row.farm_summary.days + ' days, ' + esc(row.farm_summary.difficulty) + '.</span>' : '') +
        '</button>';
    }).join('');
    return '<div class="panel"><h2>This week&rsquo;s focus</h2>' +
      '<p class="sub">The eight highest-valued rows whose TVL grew in the last seven days, ranked by implied value &times; growth factor. Momentum plus size: a launch worth farming now, not only a large one. The rule is fixed and stated — the list is what the snapshot says this week, and it changes when the snapshot does.</p>' +
      '<div class="focus-grid">' + cards + '</div>' +
      '<p class="foot">Select a card for the protocol&rsquo;s full model breakdown and farm plan.</p></div>';
  }

  // ------------------------------------------------------------- live tab

  function liveView() {
    var top = DATA.live.slice(0, 40);
    var rows = top.map(function (r) {
      return '<tr><td><div class="name"><b>' + esc(r.name) + '</b>' +
        '<span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">' + fmtMult(r.ratio) + '</td></tr>';
    }).join('');
    return '<div class="panel"><h2>Live tokens</h2>' +
      '<p class="sub">These protocols already trade, so their market caps are facts, not a model — and they are the evidence the model is built from. All ' + DATA.live_size + ' live tokens with a positive market cap set the category multiples and the size curve, and calibrate the model leave-one-out. The table shows the 40 largest by market cap.</p>' +
      '<div class="table-wrap"><table><caption>Live-token protocols, largest market cap first. Market cap / TVL is the ratio the multiples are fitted from.</caption>' +
      '<thead><tr><th scope="col">Protocol</th><th scope="col" class="num">TVL</th><th scope="col" class="num">7d</th><th scope="col" class="num">Market cap</th><th scope="col" class="num">Mcap / TVL</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  // ------------------------------------------------------------ model tab

  function rangeOf(key) {
    var vals = DATA.rows.map(function (r) { return r[key]; });
    return [Math.min.apply(null, vals), Math.max.apply(null, vals)];
  }

  function modelView() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var g = rangeOf('growth_multiplier');
    var mt = rangeOf('maturity_multiplier');
    var b = rangeOf('breadth_multiplier');
    var d = rangeOf('dominance_multiplier');
    var s = rangeOf('size_multiplier');
    var multRows = DATA.multiples.map(function (x) {
      return '<tr><td>' + esc(x.category) + '</td><td class="num">' + x.n + '</td>' +
        '<td class="num">' + fmtMult(x.raw) + '</td><td class="num">' + fmtMult(x.multiple) + '</td></tr>';
    }).join('');
    var sizeRows = DATA.size_curve.map(function (x) {
      return '<tr><td class="num">' + esc(x.label) + '</td><td class="num">' + fmtMult(x.factor) + '</td></tr>';
    }).join('');
    return '<div class="panel"><h2>How it scores</h2>' +
      '<p class="sub">One formula scores every row, from the snapshot&rsquo;s own figures only. No protocol name is ever special-cased, and no row is hand-picked. The page recomputes each row from those figures — open any protocol to see the check.</p>' +
      '<div class="formula">implied = round( TVL &times; category multiple &times; growth &times; maturity &times; breadth &times; dominance &times; size )</div>' +
      '<div class="callout"><h3>Calibration — measured, not claimed</h3>' +
      '<p><span class="big">' + (cal.within_2x * 100).toFixed(0) + '% within 2&times;</span> &nbsp; <span class="big">' + (cal.within_3x * 100).toFixed(0) + '% within 3&times;</span> &nbsp; <span class="big">' + (cal.within_5x * 100).toFixed(0) + '% within 5&times;</span></p>' +
      '<p>Leave-one-out on the snapshot&rsquo;s own ' + cal.n + ' live-token protocols: each token&rsquo;s market cap is predicted with a model fitted without it. Median predicted / actual <b>' + cal.median_ratio.toFixed(2) + '&times;</b> (middle half ' + cal.p25_ratio.toFixed(2) + '&times; &ndash; ' + cal.p75_ratio.toFixed(2) + '&times;). The honest limit: market-cap-per-TVL varies enormously inside a category, so the model prices each category&rsquo;s centre, never a single token&rsquo;s cap. Its edge is structural — it prices Dexs above Lending per TVL dollar, as the market does — not predictive precision.</p></div>' +
      '<div class="grid2"><div><h3 class="sec">The six factors</h3>' +
      '<table class="mini"><thead><tr><th scope="col">Factor</th><th scope="col">What it is</th><th scope="col" class="num">Range on this board</th></tr></thead><tbody>' +
      '<tr><td>Category multiple</td><td>Geometric mean of the live tokens&rsquo; market-cap-per-TVL in the category, shrunk toward the ' + fmtMult(m.global_multiple) + ' global mean (prior strength k=' + m.shrinkage_k + '), clamped ' + m.multiple_floor + '&ndash;' + m.multiple_cap + '&times;.</td><td class="num">' + fmtMult(Math.min.apply(null, DATA.multiples.map(function (x) { return x.multiple; }))) + ' &ndash; ' + fmtMult(Math.max.apply(null, DATA.multiples.map(function (x) { return x.multiple; }))) + '</td></tr>' +
      '<tr><td>Growth</td><td>Seven-day TVL change, log-damped: (1 + g/100)^' + m.growth_exponent + ', g clamped ' + m.growth_floor + '%&hellip;+' + m.growth_cap + '%.</td><td class="num">' + g[0].toFixed(2) + ' &ndash; ' + g[1].toFixed(2) + '</td></tr>' +
      '<tr><td>Maturity</td><td>Time with no token: ' + m.maturity_floor + ' + ' + m.maturity_range + ' &times; min(age, ' + m.maturity_days + 'd) / ' + m.maturity_days + 'd; unknown age counts ' + m.unknown_age_days + 'd.</td><td class="num">' + mt[0].toFixed(2) + ' &ndash; ' + mt[1].toFixed(2) + '</td></tr>' +
      '<tr><td>Breadth</td><td>1 + ' + m.breadth_per_chain + ' per chain beyond the first, up to ' + m.breadth_max_chains + ' extra chains.</td><td class="num">' + b[0].toFixed(2) + ' &ndash; ' + b[1].toFixed(2) + '</td></tr>' +
      '<tr><td>Dominance</td><td>1 + ' + m.dominance_weight + ' &times; the protocol&rsquo;s share of its category&rsquo;s TVL.</td><td class="num">' + d[0].toFixed(2) + ' &ndash; ' + d[1].toFixed(2) + '</td></tr>' +
      '<tr><td>Size</td><td>Fitted curve exp(' + m.size_slope.toFixed(2) + ' &times; (ln TVL &minus; ' + m.size_centre_log_tvl.toFixed(1) + ')), clamped ' + (1 / 3).toFixed(2) + '&ndash;' + m.size_cap + '&times;. The market values each extra TVL dollar less than the last.</td><td class="num">' + s[0].toFixed(2) + ' &ndash; ' + s[1].toFixed(2) + '</td></tr>' +
      '</tbody></table></div>' +
      '<div><h3 class="sec">The size curve</h3>' +
      '<table class="mini"><thead><tr><th scope="col" class="num">Protocol TVL</th><th scope="col" class="num">Size factor</th></tr></thead><tbody>' + sizeRows + '</tbody></table>' +
      '<p class="sub">The slope (' + m.size_slope.toFixed(3) + ') is fitted by least squares on the live tokens&rsquo; residual log-ratios, after the multiple and the other factors — so nothing is counted twice. A $5M protocol scores 2.43&times; on size; a $5B one is clamped at 0.33&times;.</p>' +
      '<h3 class="sec">What the model does not do</h3>' +
      '<p class="sub">It does not predict whether or when a token launches. It does not price a single token&rsquo;s cap closely — the calibration box says how far off it can be. It reads nothing outside the snapshot: no prices, no social signals, no team. And it does not rank exchanges, bridges, liquid staking or versioned pools; those are set aside, not scored.</p>' +
      '</div></div>' +
      '<h3 class="sec">Category multiples, derived from the snapshot</h3>' +
      '<p class="sub">Raw is the geometric mean of the live tokens&rsquo; market-cap-per-TVL in the category; shrunk is the multiple the model uses after the hierarchical prior. Small categories blend toward the global ' + fmtMult(m.global_multiple) + ' instead of flipping to it.</p>' +
      '<div class="table-wrap"><table class="mini"><thead><tr><th scope="col">Category</th><th scope="col" class="num">Live tokens</th><th scope="col" class="num">Raw geometric mean</th><th scope="col" class="num">Multiple used</th></tr></thead>' +
      '<tbody>' + multRows + '</tbody></table></div>' +
      '<p class="foot">Source: DefiLlama protocol index, snapshot ' + esc(DATA.as_of) + '. The snapshot is sealed: every run of the program reads the same bytes.</p></div>';
  }

  // ---------------------------------------------------------- set-aside tab

  function setAsideView() {
    var rows = DATA.set_aside.map(function (g) {
      return '<tr><td><b>' + esc(g.reason) + '</b></td><td class="num">' + g.count + '</td>' +
        '<td class="num">' + fmtUsd(g.tvl_usd) + '</td>' +
        '<td>' + g.examples.map(esc).join(', ') + '</td></tr>';
    }).join('');
    return '<div class="panel"><h2>Set aside, not ranked</h2>' +
      '<p class="sub">' + DATA.set_aside_size + ' pre-token protocols — ' + fmtUsd(DATA.set_aside_tvl_usd) + ' of TVL — are set aside by the house&rsquo;s own watchlist rule, applied board-wide. Ranking them would be plainly wrong: an exchange is not a launch, a wrapped token is not a protocol still waiting on one, and a versioned pool is a pool of another protocol. The rule is the same one that drew the watchlist, so the board&rsquo;s exclusions are checkable, not a judgement call.</p>' +
      '<div class="table-wrap"><table><caption>Pre-token protocols set aside, by reason. Examples are the largest by TVL in each group.</caption>' +
      '<thead><tr><th scope="col">Reason</th><th scope="col" class="num">Protocols</th><th scope="col" class="num">TVL</th><th scope="col">Largest examples</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  // ------------------------------------------------------------ compare tab

  function compareView() {
    if (state.compare.length < 2) return boardTable();
    var a = bySlug(state.compare[0]);
    var b = bySlug(state.compare[1]);
    if (!a || !b) return boardTable();
    var pa = impliedParts(a);
    var pb = impliedParts(b);
    function row2(label, va, vb) {
      return '<tr><td>' + label + '</td><td>' + va + '</td><td>' + vb + '</td></tr>';
    }
    var perA = a.implied_value_usd / a.farm_summary.capital_usd;
    var perB = b.implied_value_usd / b.farm_summary.capital_usd;
    var win = a.implied_value_usd >= b.implied_value_usd ? a : b;
    var lose = win === a ? b : a;
    return '<div class="panel"><h2>' + esc(a.name) + ' vs ' + esc(b.name) + '</h2>' +
      '<p class="sub">Two protocols, every factor side by side. The verdict follows the board&rsquo;s own claim: the higher implied value, per dollar of farm capital.</p>' +
      '<p class="verdict">Farm <b>' + esc(win.name) + '</b> first — ' + fmtUsd(win.implied_value_usd) + ' implied against ' + fmtUsd(lose.implied_value_usd) + ', for $' + win.farm_summary.capital_usd + ' of capital (' + fmtUsd(win.implied_value_usd / win.farm_summary.capital_usd) + ' of implied value per $1 farmed).</p>' +
      '<div class="table-wrap"><table class="cmp-table"><thead><tr><th scope="col"></th><th scope="col">' + esc(a.name) + ' (rank ' + a.rank + ')</th><th scope="col">' + esc(b.name) + ' (rank ' + b.rank + ')</th></tr></thead><tbody>' +
      row2('Category', esc(a.category || 'Other'), esc(b.category || 'Other')) +
      row2('Chains', esc((a.chains || []).join(', ')), esc((b.chains || []).join(', '))) +
      row2('TVL', fmtUsd(a.tvl_usd), fmtUsd(b.tvl_usd)) +
      row2('7d change', fmtPct(a.change_7d), fmtPct(b.change_7d)) +
      row2('Age with no token', fmtAge(a.age_days), fmtAge(b.age_days)) +
      row2('Implied value', '<b>' + fmtUsd(a.implied_value_usd) + '</b>', '<b>' + fmtUsd(b.implied_value_usd) + '</b>') +
      row2('Value / TVL', fmtMult(a.implied_value_usd / a.tvl_usd), fmtMult(b.implied_value_usd / b.tvl_usd)) +
      row2('Category multiple', fmtMult(pa.multiple) + ' (n=' + a.multiple_n + ')', fmtMult(pb.multiple) + ' (n=' + b.multiple_n + ')') +
      row2('Growth factor', fmtFactor(pa.growth), fmtFactor(pb.growth)) +
      row2('Maturity factor', fmtFactor(pa.maturity), fmtFactor(pb.maturity)) +
      row2('Breadth factor', fmtFactor(pa.breadth), fmtFactor(pb.breadth)) +
      row2('Dominance factor', fmtFactor(pa.dominance), fmtFactor(pb.dominance)) +
      row2('Size factor', fmtFactor(pa.size), fmtFactor(pb.size)) +
      row2('Farm capital', '$' + a.farm_summary.capital_usd, '$' + b.farm_summary.capital_usd) +
      row2('Farm gas (total)', '~$' + a.farm_summary.gas_usd, '~$' + b.farm_summary.gas_usd) +
      row2('Farm span', a.farm_summary.days + ' days', b.farm_summary.days + ' days') +
      row2('Difficulty', esc(a.farm_summary.difficulty), esc(b.farm_summary.difficulty)) +
      row2('Implied per $1 capital', fmtUsd(perA), fmtUsd(perB)) +
      '</tbody></table></div>' +
      '<p class="foot"><button class="button ghost" type="button" data-act="clear-compare">Clear comparison</button> ' +
      '<button class="button" type="button" data-act="tab" data-tab="board">Back to the board</button></p></div>';
  }

  // ----------------------------------------------------------- detail view

  var dialog = null;
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'detail';
    dialog.setAttribute('aria-labelledby', 'detail-title');
    dialog.addEventListener('close', function () {
      state.selected = null;
      writeHash();
      render();
    });
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function openDetail(slug) {
    var row = bySlug(slug);
    if (!row) return;
    state.selected = slug;
    writeHash();
    var d = ensureDialog();
    var p = impliedParts(row);
    var diff = p.implied - row.implied_value_usd;
    var check = Math.abs(diff) <= 1
      ? '<b>Matches.</b> This page recomputes the row from the snapshot&rsquo;s own figures and gets ' + fmtUsdFull(p.implied) + ' — the same number board.json carries.'
      : 'This page recomputes ' + fmtUsdFull(p.implied) + ' from the snapshot&rsquo;s figures; board.json carries ' + fmtUsdFull(row.implied_value_usd) + ' (difference ' + fmtUsdFull(diff) + ').';
    var multNote = row.multiple_n === 0
      ? 'no live token in this category — the global multiple applies'
      : row.multiple_n + ' live token' + (row.multiple_n === 1 ? '' : 's') + ' in this category, shrunk toward the ' + fmtMult(DATA.model.global_multiple) + ' global mean';
    var catTvl = DATA.cat_tvl[row.category || 'Other'] || row.tvl_usd;
    var share = (row.tvl_usd / catTvl) * 100;
    var sizeNote = p.size <= DATA.model.size_floor + 1e-9
      ? 'TVL above the curve — clamped at the ' + DATA.model.size_floor.toFixed(2) + ' floor'
      : p.size >= DATA.model.size_cap - 1e-9
        ? 'TVL below the curve — clamped at the ' + DATA.model.size_cap + ' cap'
        : 'TVL ' + fmtUsd(row.tvl_usd) + ' against the $' + Math.round(Math.exp(DATA.model.size_centre_log_tvl) / 1e6) + 'M centre';
    var ageNote = row.age_days === null ? 'listing date unknown — counts ' + DATA.model.unknown_age_days + ' days' : fmtAge(row.age_days) + ' since first listed';
    var steps = row.farm_steps.map(function (s, i) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      var cls = i === 7 ? ' class="risk"' : '';
      return '<li' + cls + '><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    var fs = row.farm_summary;
    d.innerHTML =
      '<div class="detail-head"><div><span class="rk">Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : ' · Early find') + '</span>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') + ' · records no token</p></div>' +
      '<button class="close" type="button" data-act="close-detail" aria-label="Close details">Close</button></div>' +
      '<div class="detail-body"><div>' +
      '<h3>Implied value <span class="n">— model ' + esc(DATA.model_version) + '</span></h3>' +
      '<table class="breakdown"><tbody>' +
      '<tr><td>TVL</td><td>' + fmtUsdFull(row.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple</td><td>' + fmtMult(p.multiple) + ' <span style="color:var(--muted)">(' + esc(multNote) + ')</span></td></tr>' +
      '<tr><td>Growth</td><td>' + fmtFactor(p.growth) + ' <span style="color:var(--muted)">(' + fmtPct(row.change_7d) + ' in 7 days, log-damped)</span></td></tr>' +
      '<tr><td>Maturity</td><td>' + fmtFactor(p.maturity) + ' <span style="color:var(--muted)">(' + esc(ageNote) + ')</span></td></tr>' +
      '<tr><td>Breadth</td><td>' + fmtFactor(p.breadth) + ' <span style="color:var(--muted)">(' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ')</span></td></tr>' +
      '<tr><td>Dominance</td><td>' + fmtFactor(p.dominance) + ' <span style="color:var(--muted)">(' + share.toFixed(1) + '% of its category&rsquo;s TVL)</span></td></tr>' +
      '<tr><td>Size</td><td>' + fmtFactor(p.size) + ' <span style="color:var(--muted)">(' + esc(sizeNote) + ')</span></td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + fmtUsdFull(row.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="check">' + check + ' This is an estimate, not a price, and never a prediction that a token launches.</p>' +
      '<h3>Farm plan — the totals</h3>' +
      '<div class="chips"><span class="chip">Capital <b>$' + fs.capital_usd + '</b></span>' +
      '<span class="chip">Gas <b>~$' + fs.gas_usd + ' total</b></span>' +
      '<span class="chip"><b>~$' + fs.gas_per_week_usd + '/week</b></span>' +
      '<span class="chip"><b>' + fs.days + ' days</b></span>' +
      '<span class="chip">' + esc(fs.difficulty) + '</span>' +
      '<span class="chip"><b>' + fs.transactions + ' transactions</b> on ' + esc((row.chains || [])[0] || 'its main chain') + '</span></div>' +
      '<p class="check">Gas is priced per transaction on ' + esc((row.chains || [])[0] || 'its main chain') + '; totals include a $1.50 bridge fee and one transaction a week for the hold.</p>' +
      '</div><div>' +
      '<h3>Farm plan <span class="n">— ' + row.farm_steps.length + ' steps, in order</span></h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '</div></div>';
    if (typeof d.showModal === 'function') {
      if (!d.open) d.showModal();
    } else {
      d.setAttribute('open', '');
    }
    render();
  }

  // ---------------------------------------------------------------- render

  function render() {
    var activeId = document.activeElement && document.activeElement.id;
    var selStart = null;
    var selEnd = null;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      selStart = document.activeElement.selectionStart;
      selEnd = document.activeElement.selectionEnd;
    }
    var tab = state.tab;
    if (tab === 'compare' && state.compare.length < 2) tab = 'board';
    var body = '';
    if (tab === 'board') body = focusStrip() + boardTable();
    else if (tab === 'focus') body = focusView();
    else if (tab === 'live') body = liveView();
    else if (tab === 'model') body = modelView();
    else if (tab === 'setaside') body = setAsideView();
    else if (tab === 'compare') body = compareView();
    app.innerHTML = '<div class="shell">' + masthead() + lede() + tabsBar() + body + '</div>';
    app.setAttribute('aria-busy', 'false');
    if (activeId) {
      var el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (selStart !== null && el.setSelectionRange) {
          try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text input */ }
        }
      }
    }
    if (state.selected && (!dialog || !dialog.open)) openDetail(state.selected);
  }

  // ---------------------------------------------------------------- events

  document.addEventListener('click', function (e) {
    var act = e.target.closest('[data-act]');
    if (act) {
      var a = act.getAttribute('data-act');
      if (a === 'tab') {
        e.preventDefault();
        state.tab = act.getAttribute('data-tab');
        writeHash();
        render();
        return;
      }
      if (a === 'open') {
        e.preventDefault();
        openDetail(act.getAttribute('data-slug'));
        return;
      }
      if (a === 'sort') {
        var key = act.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
        return;
      }
      if (a === 'toggle-watch') { state.watch = !state.watch; writeHash(); render(); return; }
      if (a === 'toggle-early') { state.early = !state.early; writeHash(); render(); return; }
      if (a === 'clear') {
        state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; state.early = false;
        writeHash(); render(); return;
      }
      if (a === 'clear-compare') { state.compare = []; state.tab = 'board'; render(); return; }
      if (a === 'close-detail') { if (dialog) dialog.close(); return; }
    }
    var row = e.target.closest('tr[data-slug]');
    if (row && !e.target.closest('.cmpbox')) {
      openDetail(row.getAttribute('data-slug'));
    }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-slug]')) {
      e.preventDefault();
      openDetail(e.target.getAttribute('data-slug'));
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('cmpbox')) {
      var slug = t.getAttribute('data-slug');
      var at = state.compare.indexOf(slug);
      if (t.checked) {
        if (at < 0 && state.compare.length < 2) state.compare.push(slug);
      } else if (at >= 0) {
        state.compare.splice(at, 1);
      }
      render();
      return;
    }
    if (t.id === 'category') { state.category = t.value; writeHash(); render(); }
    if (t.id === 'chain') { state.chain = t.value; writeHash(); render(); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') {
      state.q = e.target.value;
      writeHash();
      render();
    }
  });
  window.addEventListener('hashchange', function () {
    readHash();
    render();
  });

  readHash();
  if (TABS.map(function (t) { return t[0]; }).concat(['compare']).indexOf(state.tab) < 0) state.tab = 'board';
  render();
})();
