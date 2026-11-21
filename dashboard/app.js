// Token Launch Radar — board rendering, filters, detail views, charts.
// All data comes from data.js (generated from the snapshot by main.ts). Farm steps
// and valuation drivers are rebuilt here from the same templates and figures, so
// what the page shows agrees with board.json.
(function () {
  'use strict';
  var D = window.RADAR;
  var CATS = D.categories, CHAINS = D.chains, ROWS = D.rows;
  var CONF = ['Low', 'Medium', 'High'];
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 2).replace(/\.00$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function gasFor(chain) { return D.gas[chain] || '$0.10–1.00'; }
  function amountFor(tvl) {
    if (tvl >= 1e9) return '$1,000';
    if (tvl >= 250e6) return '$500';
    if (tvl >= 50e6) return '$250';
    return '$100';
  }
  function catOf(r) { return CATS[r[2]]; }
  function catName(r) { return CATS[r[2]][0]; }
  function chainsOf(r) { return r[3].map(function (i) { return CHAINS[i]; }); }

  // ---- farm steps (same templates and substitution as main.ts) ----
  function farmSteps(r) {
    var chain = chainsOf(r)[0] || 'Ethereum';
    var tpl = D.templates[catName(r)] || D.generic;
    return tpl.map(function (s) {
      return s.split('{name}').join(r[1]).split('{chain}').join(chain)
        .split('{amt}').join(amountFor(r[4])).split('{gas}').join(gasFor(chain))
        .split('{tvl}').join(money(r[4]));
    });
  }

  // ---- valuation drivers (same formulas as main.ts) ----
  function drivers(r) {
    var c = catOf(r), ratio = c[2], n = c[1];
    var out = ['TVL ' + money(r[4]) + ' × peer ratio ' + ratio.toFixed(3) +
      ' (' + n + ' launched ' + c[0] + ' peer' + (n === 1 ? '' : 's') + ')'];
    if (r[5] === null) out.push('7-day TVL change not reported, so no growth adjustment');
    else {
      var gf = 1 + clamp(r[5], -30, 30) * 0.004;
      out.push('7-day TVL ' + (r[5] >= 0 ? '+' : '') + r[5].toFixed(1) + '% → ×' + gf.toFixed(3));
    }
    if (r[6] === null) out.push('Listing date not reported, so no age adjustment');
    else {
      var yrs = r[6] / 365, af = 0.92 + 0.08 * (Math.min(yrs, 4) / 4);
      out.push('Running ' + yrs.toFixed(1) + ' years with no token recorded → ×' + af.toFixed(3));
    }
    return out;
  }

  // ---- inline SVG bar chart ----
  function svgBars(items, max) {
    var W = 640, BH = 22, GAP = 6, top = 6;
    var H = top * 2 + items.length * (BH + GAP) - GAP;
    var body = items.map(function (it, i) {
      var y = top + i * (BH + GAP);
      var w = Math.max(2, (it[1] / max) * (W - 260));
      var fill = it[2] || '#0b5fff';
      return '<text x="0" y="' + (y + 15) + '" font-size="12.5" fill="currentColor">' + esc(it[0]) + '</text>' +
        '<rect x="150" y="' + y + '" width="' + w.toFixed(1) + '" height="16" rx="3" fill="' + fill + '"/>' +
        '<text x="' + (150 + w + 8).toFixed(1) + '" y="' + (y + 15) + '" font-size="12.5" fill="currentColor">' + esc(it[3]) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Bar chart">' + body + '</svg>';
  }

  // ---- state from URL hash ----
  function readHash() {
    var h = {}, parts = (location.hash || '').slice(1).split('&');
    parts.forEach(function (p) {
      var kv = p.split('=');
      if (kv[0]) h[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    return h;
  }
  var state = { q: '', cat: '', chain: '', size: '', conf: '', sort: 'rank', detail: '' };
  function applyHash() {
    var h = readHash();
    state.q = h.q || ''; state.cat = h.cat || ''; state.chain = h.chain || '';
    state.size = h.size || ''; state.conf = h.conf || ''; state.sort = h.sort || 'rank';
    state.detail = h.detail || '';
  }
  function writeHash() {
    var p = [];
    if (state.q) p.push('q=' + encodeURIComponent(state.q));
    if (state.cat) p.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain) p.push('chain=' + encodeURIComponent(state.chain));
    if (state.size) p.push('size=' + state.size);
    if (state.conf) p.push('conf=' + state.conf);
    if (state.sort !== 'rank') p.push('sort=' + state.sort);
    if (state.detail) p.push('detail=' + encodeURIComponent(state.detail));
    history.replaceState(null, '', p.length ? '#' + p.join('&') : location.pathname + location.search);
  }

  // ---- controls ----
  function fillSelects() {
    var cat = $('cat'), chain = $('chain');
    cat.innerHTML = '<option value="">All categories</option>' + CATS.map(function (c) {
      return '<option value="' + esc(c[0]) + '">' + esc(c[0]) + ' (' + c[1] + ' peers)</option>';
    }).join('');
    chain.innerHTML = '<option value="">All chains</option>' + CHAINS.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
  }
  function syncControls() {
    $('q').value = state.q; $('cat').value = state.cat; $('chain').value = state.chain;
    $('size').value = state.size; $('conf').value = state.conf; $('sort').value = state.sort;
  }

  // ---- filtering & sorting ----
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (q && r[1].toLowerCase().indexOf(q) < 0 && r[0].toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && catName(r) !== state.cat) return false;
      if (state.chain && chainsOf(r).indexOf(state.chain) < 0) return false;
      if (state.conf !== '' && String(r[10]) !== state.conf) return false;
      if (state.size === 'huge' && r[4] < 1e9) return false;
      if (state.size === 'big' && (r[4] < 250e6 || r[4] >= 1e9)) return false;
      if (state.size === 'mid' && (r[4] < 50e6 || r[4] >= 250e6)) return false;
      if (state.size === 'small' && r[4] >= 50e6) return false;
      return true;
    });
    var by = state.sort;
    list.sort(function (a, b) {
      if (by === 'tvl') return b[4] - a[4];
      if (by === 'growth') return (b[5] === null ? -1e9 : b[5]) - (a[5] === null ? -1e9 : a[5]);
      if (by === 'age') return (b[6] === null ? -1 : b[6]) - (a[6] === null ? -1 : a[6]);
      if (by === 'name') return a[1] < b[1] ? -1 : 1;
      return ROWS.indexOf(a) - ROWS.indexOf(b);
    });
    return list;
  }

  function rowHtml(r, rank) {
    var chg = r[5] === null ? '<span>—</span>' :
      '<span class="' + (r[5] >= 0 ? 'up' : 'down') + '">' + (r[5] >= 0 ? '+' : '') + r[5].toFixed(1) + '%</span>';
    var age = r[6] === null ? '—' : (r[6] / 365).toFixed(1) + 'y';
    var conf = CONF[r[10]];
    return '<tr data-slug="' + esc(r[0]) + '" class="' + (state.detail === r[0] ? 'sel' : '') + '">' +
      '<td class="num">' + rank + '</td>' +
      '<td><b>' + esc(r[1]) + '</b><br><span class="slug">' + esc(r[0]) + '</span></td>' +
      '<td>' + esc(catName(r)) + '</td>' +
      '<td>' + esc(chainsOf(r).slice(0, 3).join(', ')) + (r[3].length > 3 ? ' +' + (r[3].length - 3) : '') + '</td>' +
      '<td class="num">' + money(r[4]) + '</td>' +
      '<td class="num">' + chg + '</td>' +
      '<td class="num">' + age + '</td>' +
      '<td class="num"><b>' + money(r[8]) + '</b><span class="range">' + money(r[7]) + ' – ' + money(r[9]) + '</span></td>' +
      '<td><span class="pill ' + (conf === 'High' ? 'hi' : conf === 'Medium' ? 'med' : 'lo') + '">' + conf + '</span></td></tr>';
  }

  function renderBoard() {
    var list = filtered();
    $('rows').innerHTML = list.map(function (r, i) { return rowHtml(r, ROWS.indexOf(r) + 1); }).join('');
    $('count').textContent = list.length + ' of ' + ROWS.length + ' protocols shown' +
      (list.length !== ROWS.length ? ' — filtered' : '');
    $('empty').hidden = list.length > 0;
  }

  // ---- detail view ----
  function findRow(slug) {
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i][0] === slug) return ROWS[i];
    return null;
  }
  function renderDetail() {
    var el = $('detail');
    var r = state.detail ? findRow(state.detail) : null;
    if (!r) { el.hidden = true; el.innerHTML = ''; return; }
    var c = catOf(r);
    var age = r[6] === null ? 'Not reported' : (r[6] / 365).toFixed(1) + ' years';
    var chg = r[5] === null ? 'Not reported' : (r[5] >= 0 ? '+' : '') + r[5].toFixed(1) + '%';
    var peers = c[5];
    var maxV = Math.max(r[9], r[8], r[7]);
    var rangeChart = svgBars([
      ['High', r[9], '#6b645a', money(r[9])],
      ['Implied value', r[8], '#0b5fff', money(r[8])],
      ['Low', r[7], '#6b645a', money(r[7])],
    ], maxV);
    var peerItems = [[r[1] + ' (this)', r[4], '#0b5fff', money(r[4])]].concat(peers.map(function (p) {
      return [p[1], p[3], '#6b645a', money(p[3])];
    }));
    var peerMax = Math.max.apply(null, peerItems.map(function (x) { return x[1]; }));
    var steps = farmSteps(r).map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>';
    }).join('');
    var peerRows = peers.length ? peers.map(function (p) {
      return '<tr><td>' + esc(p[1]) + '</td><td class="num">' + money(p[2]) + '</td>' +
        '<td class="num">' + money(p[3]) + '</td><td class="num">' + p[4].toFixed(2) + '×</td></tr>';
    }).join('') : '<tr><td colspan="4">No launched peer in this category — the value leans on the global median instead.</td></tr>';
    el.innerHTML =
      '<button class="close" id="closeDetail">Close ✕</button>' +
      '<h2>' + esc(r[1]) + '</h2>' +
      '<p class="sub">Rank #' + (ROWS.indexOf(r) + 1) + ' · ' + esc(r[0]) + ' · ' + esc(catName(r)) + ' · ' +
      esc(chainsOf(r).join(', ')) + ' · Records no token</p>' +
      '<div class="kv">' +
      '<div><b>' + money(r[8]) + '</b><span>Implied value if launched</span></div>' +
      '<div><b>' + money(r[7]) + ' – ' + money(r[9]) + '</b><span>Low – high range</span></div>' +
      '<div><b>' + money(r[4]) + '</b><span>TVL</span></div>' +
      '<div><b>' + chg + '</b><span>TVL change, 7 days</span></div>' +
      '<div><b>' + age + '</b><span>Running with no token</span></div>' +
      '<div><b>' + CONF[r[10]] + '</b><span>Confidence</span></div></div>' +
      '<h3>Why this value</h3><ol>' + drivers(r).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ol>' +
      rangeChart +
      '<h3>Farm plan — what to do</h3><ol>' + steps + '</ol>' +
      '<p class="sub">Gas costs are rough per-transaction estimates for the chain. A token is never guaranteed; the plan is positioning, not a promise.</p>' +
      '<h3>Launched peers in ' + esc(catName(r)) + ' (market cap / TVL)</h3>' +
      '<table class="mini"><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Ratio</th></tr></thead><tbody>' + peerRows + '</tbody></table>' +
      '<h3>TVL vs its launched peers</h3>' + svgBars(peerItems, peerMax);
    el.hidden = false;
    $('closeDetail').addEventListener('click', function () {
      state.detail = ''; writeHash(); renderDetail(); renderBoard();
    });
  }

  // ---- wire up ----
  function bind() {
    fillSelects();
    applyHash(); syncControls();
    $('meta').textContent = 'Snapshot ' + D.meta.asOf + ' · ' + ROWS.length +
      ' pre-token protocols · ' + D.meta.watchlist + ' on the $' + (D.meta.floor / 1e6) + 'M watchlist · ' +
      'Global median peer ratio ' + D.meta.globalMedian + '×';
    [['q', 'input'], ['cat', 'change'], ['chain', 'change'], ['size', 'change'], ['conf', 'change'], ['sort', 'change']].forEach(function (pair) {
      $(pair[0]).addEventListener(pair[1], function (e) {
        state[pair[0]] = e.target.value; writeHash(); renderBoard();
      });
    });
    $('rows').addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
      if (!tr) return;
      state.detail = tr.getAttribute('data-slug'); writeHash(); renderDetail(); renderBoard();
      $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    window.addEventListener('hashchange', function () { applyHash(); syncControls(); renderBoard(); renderDetail(); });
    renderBoard(); renderDetail();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
