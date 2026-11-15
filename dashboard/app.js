// Token Radar's dashboard. It reads window.RADAR (data.js, written beside dashboard/ by
// main.ts) and renders the board, the detail view, the live-token reference and the model page.
// No network: every byte it shows is in data.js. No framework: plain DOM.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) { document.body.textContent = 'Token Radar: data.js is missing.'; return; }

  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = rows.length ? rows[0].implied_value_usd : 1;

  var state = { q: '', cat: '', chain: '', watch: false, sort: 'rank', dir: 1, tab: 'board', detail: null };

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

  // ---- stats ---------------------------------------------------------------
  var stats = $('stats');
  stats.innerHTML =
    '<div class="stat"><b>' + DATA.snapshot_protocols + '</b><span>protocols scanned</span></div>' +
    '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>on the watchlist</span></div>' +
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
    $('count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' ranked protocols · snapshot ' + DATA.as_of + ' · model ' + DATA.model_version;
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
  $('watch').addEventListener('change', function () { state.watch = this.checked; renderBoard(); });
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
    box.innerHTML =
      '<button class="close" id="detail-close">Close ✕</button>' +
      '<h2>' + esc(r.name) + ' <span class="sub">rank #' + r.rank + ' · ' + esc(r.slug) + (r.on_watchlist ? ' · ◆ watchlist' : '') + '</span></h2>' +
      '<p class="hint">Records no token in the snapshot. Category: ' + esc(r.category || '—') + ' · Chains: ' + esc(r.chains.join(', ') || '—') + ' · Listed: ' + esc(r.listed_at || '—') + '</p>' +
      '<div class="grid">' +
      '<div class="fact"><b>' + fmtUsd(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div class="fact"><b>' + fmtUsd(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="fact"><b>' + fmtPct(r.change_7d) + '</b><span>TVL change, 7 days</span></div>' +
      '<div class="fact"><b>' + fmtAge(r.age_days) + '</b><span>running with no token</span></div>' +
      '</div>' +
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
      '<h3>Farm plan — 7 steps</h3>' +
      '<ol class="steps">' + steps + '</ol>';
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
  $('model-note').textContent = 'Model ' + DATA.model_version + '. Global median mcap/TVL across ' +
    'live-token protocols: ' + DATA.global_median.toFixed(3) + '×. Only categories with at least 3 live tokens set ' +
    'their own multiple; the rest use the global median. Multiples are clamped to ' +
    DATA.model.multiple_floor + '–' + DATA.model.multiple_cap + ' and shrunk toward the global median with prior weight ' +
    DATA.model.shrink_prior + '. Growth is clamped to ' + DATA.model.growth_floor + '%…+' + DATA.model.growth_cap +
    '% at half weight; maturity runs ' + DATA.model.maturity_floor + '–' + (DATA.model.maturity_floor + DATA.model.maturity_range) +
    ' over ' + DATA.model.maturity_days + ' days. ' + DATA.set_aside_size + ' pre-token protocols are set aside, not ranked: ' +
    'wrapped, staked or bridged products of tokens that already trade, exchanges and versioned pools are not launches waiting to happen.';

  // ---- tabs ----------------------------------------------------------------
  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    $('view-board').hidden = tab !== 'board';
    $('view-live').hidden = tab !== 'live';
    $('view-model').hidden = tab !== 'model';
  }
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
  });

  // ---- hash routing: #p/<slug> opens a detail, #c/<category> filters, #w is watchlist-only
  function applyHash() {
    var h = location.hash || '';
    if (h.indexOf('#p/') === 0) {
      var slug = decodeURIComponent(h.slice(3));
      if (bySlug[slug]) { state.detail = slug; switchTab('board'); renderDetail(); renderBoard(); }
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
    if (state.detail) { state.detail = null; renderDetail(); renderBoard(); }
  }
  window.addEventListener('hashchange', applyHash);

  renderBoard();
  applyHash();
})();
