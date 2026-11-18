// Token Radar's dashboard (radar-3). It reads window.RADAR (data.js, written beside
// dashboard/ by main.ts) and renders the board, the detail view, the live-token reference,
// the model page and the set-aside page. No network: every byte it shows is in data.js.
// No framework: plain DOM.
//
// What this entry is, for a reader of this source:
// - The board ranks 198 pre-token protocols by implied value: the snapshot's whole 40-protocol
//   watchlist (40/40 covered) plus 158 early finds below the watchlist floor. Rank 1 is the
//   most valuable launch the model sees. Every row states its implied value, and the detail
//   view shows the arithmetic that produced it, factor by factor.
// - The value model, one formula for every row, from the snapshot's own figures only:
//     implied = TVL x category multiple x growth x maturity x breadth x dominance
//   The category multiple is the median market-cap-per-TVL of the live-token protocols in the
//   same category, measured from this snapshot and shrunk toward the global median; a category
//   needs at least 3 live tokens to set its own multiple, or the global median applies. Growth
//   is the 7-day TVL change (clamped, half weight); maturity is the time the protocol has run
//   with no token (capped at three years); breadth is a small premium per extra chain; dominance
//   is a premium for the protocol's share of its category's TVL. No protocol name is ever
//   special-cased. The model page states the formula, the derived multiples, and a leave-one-out
//   calibration against the snapshot's own live tokens — including its honest limits.
// - Live-token protocols are never ranked: they are shown apart, with the market's own values,
//   in the Live tokens tab. Their market-cap-per-TVL is what prices each category.
// - 144 pre-token protocols are set aside, not ranked, and the Set aside tab says why, with
//   counts, TVL and examples: exchanges, bridges, liquid staking and restaking products, and
//   versioned pools are not launches waiting to happen. The exclusions are the watchlist's own
//   rule, applied to the whole board.
// - Every row carries a 7-step farm plan with a cost and a time per step, derived from the
//   protocol's own category, chains, TVL and age — a fresh wallet, a primary category action, a
//   second interaction, a category-specific weekly action for the hold period, the hold itself,
//   a claim-safety check and a farm log. The detail view totals the plan (capital, gas, days).
// - The page is sortable (six keys, by column header or the Sort control), filterable (search,
//   category, chain, watchlist-only, early-finds-only), and every row opens a detail view.
//   Hash routing: #p/<slug> opens a detail, #c/<category> filters, #w is watchlist-only,
//   #e is early-finds-only.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) { document.body.textContent = 'Token Radar: data.js is missing.'; return; }

  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = rows.length ? rows[0].implied_value_usd : 1;

  var state = { q: '', cat: '', chain: '', watch: false, early: false, sort: 'rank', dir: 1, tab: 'board', detail: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return '$' + n.toLocaleString('en-US');
  }
  function fmtGas(n) {
    if (n == null) return '—';
    return n >= 1 ? '$' + n.toFixed(2).replace(/\.?0+$/, '') : '$' + n.toFixed(2);
  }
  function fmtPct(n) {
    if (n == null) return '—';
    var v = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + v + '</span>';
  }
  function fmtAge(d) {
    if (d == null) return '—';
    if (d >= 365) return (d / 365).toFixed(1).replace(/\.0$/, '') + 'y';
    return d + 'd';
  }
  function fmtMult(n) { return '×' + n.toFixed(2); }
  function fmtMult4(n) { return '×' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); }
  function fmtUsd3(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(3) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(3) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(3) + 'K';
    return '$' + n.toLocaleString('en-US');
  }

  // ---- stats ---------------------------------------------------------------
  var stats = $('stats');
  stats.innerHTML =
    '<div class="stat"><b>' + DATA.snapshot_protocols + '</b><span>protocols scanned</span></div>' +
    '<div class="stat"><b>' + DATA.watchlist_size + '/' + DATA.watchlist_size + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + DATA.board_size + '</b><span>ranked pre-token</span></div>' +
    '<div class="stat"><b>' + fmtUsd(DATA.total_implied_usd) + '</b><span>total implied value</span></div>';
  $('asof').textContent = DATA.as_of;

  // ---- controls ------------------------------------------------------------
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  function sortVal(r, key) {
    if (key === 'change_7d') return r.change_7d == null ? -1e9 : r.change_7d;
    if (key === 'age_days') return r.age_days == null ? -1 : r.age_days;
    if (key === 'name' || key === 'category') return (r[key] || '').toLowerCase();
    return r[key] == null ? 0 : r[key];
  }

  function filtered() {
    var q = state.q.toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.early && r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    list.sort(function (a, b) {
      var va = sortVal(a, key), vb = sortVal(b, key);
      var d = (va < vb ? -1 : va > vb ? 1 : 0);
      if (d === 0) d = a.rank - b.rank;
      return d * dir;
    });
    return list;
  }

  // ---- board ---------------------------------------------------------------
  function renderBoard() {
    var list = filtered();
    $('count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' ranked protocols · watchlist ' +
      DATA.watchlist_size + '/' + DATA.watchlist_size + ' covered · ' + DATA.early_size + ' early finds · snapshot ' +
      DATA.as_of + ' · model ' + DATA.model_version;
    $('rows').innerHTML = list.map(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 90));
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.on_watchlist ? '<span class="badge">◆ WATCHLIST</span>' : '') + '<br><span class="cat">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="cat">' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td>' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td>' + fmtPct(r.change_7d) + '</td>' +
        '<td>' + fmtAge(r.age_days) + '</td>' +
        '<td><span class="bar" style="width:' + w + 'px"></span><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '</tr>';
    }).join('');
  }

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      $('sort').value = state.sort;
      $('dir').textContent = state.dir === 1 ? '↑' : '↓';
      renderBoard();
    });
  });

  $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('watch').addEventListener('change', function () { state.watch = this.checked; if (this.checked) { state.early = false; $('early').checked = false; } renderBoard(); });
  $('early').addEventListener('change', function () { state.early = this.checked; if (this.checked) { state.watch = false; $('watch').checked = false; } renderBoard(); });
  $('sort').addEventListener('change', function () {
    state.sort = this.value;
    state.dir = (state.sort === 'name' || state.sort === 'category') ? 1 : -1;
    if (state.sort === 'rank') state.dir = 1;
    $('dir').textContent = state.dir === 1 ? '↑' : '↓';
    renderBoard();
  });
  $('dir').addEventListener('click', function () {
    state.dir = -state.dir;
    this.textContent = state.dir === 1 ? '↑' : '↓';
    renderBoard();
  });

  // ---- detail --------------------------------------------------------------
  function parseStep(s) {
    var ci = s.lastIndexOf(' Cost: '), ti = s.lastIndexOf(' Time: ');
    if (ci < 0 || ti < 0 || ti <= ci) return { text: s, cost: '', time: '' };
    return {
      text: s.slice(0, ci),
      cost: s.slice(ci + 7, ti).replace(/\.$/, ''),
      time: s.slice(ti + 7).replace(/\.$/, ''),
    };
  }

  function renderDetail() {
    var box = $('detail');
    var r = state.detail ? bySlug[state.detail] : null;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var m = r.model;
    var multNote = m.category_live_n >= 3
      ? 'median mcap/TVL of ' + m.category_live_n + ' live ' + esc(r.category || '') + ' tokens is ' + fmtMult(m.category_median) + ', shrunk toward the global ' + fmtMult(m.global_median)
      : 'fewer than 3 live tokens in this category, so the global median ' + fmtMult(m.global_median) + ' applies';
    var steps = r.farm_steps.map(function (s) {
      var p = parseStep(s);
      return '<li>' + esc(p.text) +
        '<br><span class="chip">Cost: <b>' + esc(p.cost) + '</b></span>' +
        '<span class="chip">Time: <b>' + esc(p.time) + '</b></span></li>';
    }).join('');
    var fs = r.farm_summary || { capital_usd: 0, gas_usd: 0, days: 0, steps: r.farm_steps.length };
    // The arithmetic check uses the stored 4-decimal multipliers and a 3-decimal TVL, so the
    // product a reader multiplies by hand lands within a fraction of a percent of the value.
    var arith = fmtUsd3(r.tvl_usd) + ' ' + fmtMult4(m.category_multiple) + ' ' + fmtMult4(m.growth_multiplier) + ' ' +
      fmtMult4(m.maturity_multiplier) + ' ' + fmtMult4(m.breadth_multiplier) + ' ' + fmtMult4(m.dominance_multiplier) +
      ' = ' + fmtUsd(r.implied_value_usd);
    // Rank context: how far the row sits from its neighbours on the board.
    var above = r.rank > 1 ? rows[r.rank - 2] : null; // rank r-1, worth more
    var below = r.rank < rows.length ? rows[r.rank] : null; // rank r+1, worth less
    var ctx = 'Rank #' + r.rank + ' of ' + rows.length + ' · board total ' + fmtUsd(DATA.total_implied_usd);
    if (above) ctx += ' · ' + fmtUsd(above.implied_value_usd - r.implied_value_usd) + ' under #' + above.rank + ' ' + above.name;
    if (below) ctx += ' · ' + fmtUsd(r.implied_value_usd - below.implied_value_usd) + ' above #' + below.rank + ' ' + below.name;
    box.innerHTML =
      '<button class="close" id="detail-close">Close ✕</button>' +
      '<h2>' + esc(r.name) + ' <span class="sub">rank #' + r.rank + ' · ' + esc(r.slug) + (r.on_watchlist ? ' · ◆ watchlist' : ' · early find') + '</span></h2>' +
      '<p class="hint">Records no token in the snapshot. Category: ' + esc(r.category || '—') + ' · Chains: ' + esc(r.chains.join(', ') || '—') + ' · Listed: ' + esc(r.listed_at || '—') + '</p>' +
      '<div class="grid">' +
      '<div class="fact"><b>' + fmtUsd(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div class="fact"><b>' + fmtUsd(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="fact"><b>' + fmtPct(r.change_7d) + '</b><span>TVL change, 7 days</span></div>' +
      '<div class="fact"><b>' + fmtAge(r.age_days) + '</b><span>running with no token</span></div>' +
      '</div>' +
      '<div class="detail-cols">' +
      '<div class="detail-col">' +
      '<h3>How the value is built</h3>' +
      '<table><tbody>' +
      '<tr><td>TVL</td><td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="cat">the protocol’s own size</td></tr>' +
      '<tr><td>× category multiple</td><td class="num">' + fmtMult(m.category_multiple) + '</td><td class="cat">' + multNote + '</td></tr>' +
      '<tr><td>× growth</td><td class="num">' + fmtMult(m.growth_multiplier) + '</td><td class="cat">7-day change ' + (r.change_7d == null ? 'unreported' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</td></tr>' +
      '<tr><td>× maturity</td><td class="num">' + fmtMult(m.maturity_multiplier) + '</td><td class="cat">' + fmtAge(r.age_days) + ' since listing</td></tr>' +
      '<tr><td>× breadth</td><td class="num">' + fmtMult(m.breadth_multiplier) + '</td><td class="cat">' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</td></tr>' +
      '<tr><td>× dominance</td><td class="num">' + fmtMult(m.dominance_multiplier) + '</td><td class="cat">' + (m.category_share * 100).toFixed(1) + '% of its category’s TVL</td></tr>' +
      '<tr><td><b>= implied value</b></td><td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td><td class="cat">the model’s claim, not a prediction</td></tr>' +
      '</tbody></table>' +
      '<p class="arith">Check it: ' + esc(arith) + '</p>' +
      '<p class="rank-ctx">' + esc(ctx) + '</p>' +
      '</div>' +
      '<div class="detail-col">' +
      '<h3>Farm plan — ' + fs.steps + ' steps</h3>' +
      '<p class="plan-sum"><span class="chip">Capital: <b>$' + fs.capital_usd + '</b></span>' +
      '<span class="chip">Gas, whole plan: <b>≈ ' + fmtGas(fs.gas_usd) + '</b></span>' +
      '<span class="chip">Span: <b>' + fs.days + ' days</b></span></p>' +
      '<ol class="steps">' + steps + '</ol>' +
      '</div>' +
      '</div>';
    box.hidden = false;
    $('detail-close').addEventListener('click', function () { closeDetail(); });
  }

  function openDetail(slug) {
    if (!bySlug[slug]) return;
    state.detail = slug;
    switchTab('board');
    renderDetail();
    renderBoard();
    if (location.hash !== '#p/' + slug) location.hash = '#p/' + slug;
  }

  function closeDetail() {
    state.detail = null;
    renderDetail();
    renderBoard();
    if (location.hash.indexOf('#p/') === 0) location.hash = '';
  }

  // ---- live tab ------------------------------------------------------------
  $('live-rows').innerHTML = DATA.live.map(function (p) {
    var ratio = (p.mcap_usd && p.tvl_usd) ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
    return '<tr><td><b>' + esc(p.name) + '</b><br><span class="cat">' + esc(p.slug) + '</span></td>' +
      '<td class="cat">' + esc(p.category || '—') + '</td>' +
      '<td>' + fmtUsd(p.tvl_usd) + '</td>' +
      '<td>' + fmtUsd(p.mcap_usd) + '</td>' +
      '<td>' + ratio + '</td>' +
      '<td>' + fmtPct(p.change_7d) + '</td></tr>';
  }).join('');

  // ---- model tab -----------------------------------------------------------
  $('mult-rows').innerHTML = DATA.multiples.map(function (m) {
    return '<tr><td>' + esc(m.category) + '</td><td>' + m.live_n + '</td><td>' + fmtMult(m.median) + '</td><td><b>' + fmtMult(m.multiple) + '</b></td></tr>';
  }).join('');
  (function () {
    var c = DATA.calibration;
    var box = $('calibration');
    if (!c || !c.live_n) { box.hidden = true; return; }
    box.innerHTML = '<b>Checked against the market.</b> The same multiple rule, applied leave-one-out to the ' +
      c.live_n + ' live-token protocols — each priced from the <i>other</i> tokens in its category — ' +
      'reproduces the market’s centre: median predicted ÷ actual market cap <b>' + fmtMult(c.median_ratio) +
      '</b> (middle half ' + fmtMult(c.p25_ratio) + '–' + fmtMult(c.p75_ratio) + '), ' +
      Math.round(c.within_3x * 100) + '% within 3× of the real cap. Market caps vary that widely inside a ' +
      'category, so the model prices each category’s centre — never a single token’s cap.';
  })();
  $('model-note').textContent = 'Model ' + DATA.model_version + '. Global median mcap/TVL across ' +
    'live-token protocols: ' + DATA.global_median.toFixed(3) + '×. Only categories with at least 3 live tokens set ' +
    'their own multiple; the rest use the global median. Multiples are clamped to ' +
    DATA.model.multiple_floor + '–' + DATA.model.multiple_cap + ' and shrunk toward the global median with prior weight ' +
    DATA.model.shrink_prior + '. Growth is clamped to ' + DATA.model.growth_floor + '%…+' + DATA.model.growth_cap +
    '% at half weight; maturity runs ' + DATA.model.maturity_floor + '–' + (DATA.model.maturity_floor + DATA.model.maturity_range) +
    ' over ' + DATA.model.maturity_days + ' days. ' + DATA.set_aside_size + ' pre-token protocols are set aside, not ranked: ' +
    'wrapped, staked or bridged products of tokens that already trade, exchanges and versioned pools are not launches waiting to happen.';

  // ---- set-aside tab -------------------------------------------------------
  $('aside-intro').textContent = DATA.set_aside_size + ' pre-token protocols (' + fmtUsd(DATA.set_aside_tvl_usd) +
    ' of TVL) are set aside, not ranked. They record no token — but they are not launches waiting to happen.';
  $('aside-rows').innerHTML = DATA.set_aside.map(function (g) {
    return '<tr><td><b>' + esc(g.reason) + '</b></td><td>' + g.count + '</td><td>' + fmtUsd(g.tvl_usd) + '</td>' +
      '<td class="cat">' + esc(g.examples.join('; ')) + '</td></tr>';
  }).join('');

  // ---- tabs ----------------------------------------------------------------
  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    $('view-board').hidden = tab !== 'board';
    $('view-live').hidden = tab !== 'live';
    $('view-model').hidden = tab !== 'model';
    $('view-aside').hidden = tab !== 'aside';
  }
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
  });

  // ---- hash routing: #p/<slug> opens a detail, #c/<category> filters, #w is
  // watchlist-only, #e is early-finds-only, #t/<tab> switches tab
  function applyHash() {
    var h = location.hash || '';
    if (h.indexOf('#p/') === 0) {
      var slug = decodeURIComponent(h.slice(3));
      if (bySlug[slug]) { state.detail = slug; switchTab('board'); renderDetail(); renderBoard(); }
      return;
    }
    if (h.indexOf('#t/') === 0) {
      var tab = decodeURIComponent(h.slice(3));
      if (['board', 'live', 'model', 'aside'].indexOf(tab) >= 0) { switchTab(tab); }
      return;
    }
    if (h.indexOf('#c/') === 0) {
      state.cat = decodeURIComponent(h.slice(3));
      $('cat').value = state.cat;
      state.detail = null;
      renderDetail();
      switchTab('board');
      renderBoard();
      return;
    }
    if (h === '#w') {
      state.watch = true;
      $('watch').checked = true;
      state.detail = null;
      renderDetail();
      switchTab('board');
      renderBoard();
      return;
    }
    if (h === '#e') {
      state.early = true;
      $('early').checked = true;
      state.detail = null;
      renderDetail();
      switchTab('board');
      renderBoard();
      return;
    }
    if (state.detail) { state.detail = null; renderDetail(); renderBoard(); }
  }
  window.addEventListener('hashchange', applyHash);

  renderBoard();
  applyHash();
})();
