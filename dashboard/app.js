// Token Launch Radar v3 — board, filters, detail views, interactive farm
// controls, scatter plot, and a rank switch. Data from data.js; farm steps
// and economics from farm.js (the same module main.ts uses).
import { farmSteps, farmEconomics, farmSensitivity, PARAMS, money } from './farm.js';

const D = window.RADAR;
const META = D.meta, CATS = D.categories, CHAINS = D.chains;
const CAT_EFF = new Map(META.model.categoryEffect);
const BETA = META.model.beta;
const MED_AGE = META.model.medianAgeDays;
const $ = (id) => document.getElementById(id);

function ageFmt(days) {
  if (days === null || days === undefined) return '—';
  if (days < 365) return days + ' d';
  return (days / 365).toFixed(1) + ' yr';
}
// Rows are compact arrays, money in units of $100K:
// [slug, catIdx, chainIdxs, tvl100k, chg, ageDays, odds, value100k, rankLo, rankHi, sibling]
// The display name is derived from the slug. The value range is recomputed
// from the value and the LOO residual quantiles in meta, so rows stay compact.
const RQ = META.model;
function displayName(slug) {
  return slug.split('-').map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}
function rowObj(a) {
  const value = a[7] * 100000;
  return {
    slug: a[0], name: displayName(a[0]), category: CATS[a[1]], chains: a[2].map((i) => CHAINS[i]),
    tvl: a[3] * 100000, chg: a[4], age: a[5], odds: a[6], value,
    lo: Math.max(1, Math.round(value * Math.exp(RQ.resQ25))),
    hi: Math.max(1, Math.round(value * Math.exp(RQ.resQ75))),
    lo10: Math.max(1, Math.round(value * Math.exp(RQ.resQ10))),
    hi90: Math.max(1, Math.round(value * Math.exp(RQ.resQ90))),
    rankLo: a[8], rankHigh: a[9], sibling: a[10],
  };
}
const ROWS = D.rows.map(rowObj);
const BY_SLUG = new Map(ROWS.map((r) => [r.slug, r]));
// The rank is the row's position in the value-sorted array data.js was built from.
ROWS.forEach((r, i) => { r.rank = i + 1; });

function protoOf(r) {
  return { slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl };
}
// Farm economics under the current control values. Defaults match PARAMS,
// so the default view agrees with board.json.
const controls = {
  depositUsd: PARAMS.depositUsd,
  dropShare: PARAMS.dropShare,
  tbillAnnual: PARAMS.tbillAnnual,
};
function econOf(r) {
  return farmEconomics(protoOf(r), r.value, r.odds, controls);
}
function termsOf(r) {
  const lnT = Math.log(r.tvl / 100e6);
  const ageY = (r.age ?? MED_AGE) / 365;
  return {
    base: BETA[0], size: lnT * BETA[1], size2: lnT * lnT * BETA[2],
    age: ageY * BETA[3], sibling: r.sibling * BETA[4], category: CAT_EFF.get(r.category) ?? 0,
  };
}

// ---- header, ledger, model, params ----

$('metaLine').textContent =
  `Snapshot ${META.asOf} · floor ${money(META.floor)} · ${META.rows} ranked protocols · ` +
  `Huber fit on ${META.model.comparables} launched peers (market cap ≥ $1M) · ranges calibrated on leave-one-out residuals.`;
$('kpis').innerHTML = [
  [META.ledger.ranked, 'ranked'],
  [META.ledger.tokened, 'already tokened'],
  [META.ledger.excluded, 'excluded'],
  ['×' + META.validation.loo, 'typical miss (LOO)'],
  [META.verdicts.FARM, 'FARM verdicts'],
].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');

const L = META.ledger, TOT = L.ranked + L.tokened + L.excluded;
$('ledger').innerHTML = [
  ['Ranked', L.ranked, 'no token recorded'],
  ['Already tokened', L.tokened, 'a gecko id, symbol or market cap is recorded'],
  ['Excluded', L.excluded, 'no token, but a wrapped / staked / bridged product'],
].map(([t, n, d]) =>
  `<div class="bucket"><b>${n}</b><span>${t} — ${d}</span><div class="bar"><i style="width:${(100 * n / TOT).toFixed(1)}%"></i></div></div>`
).join('');
$('excluded').innerHTML = '<b>Why the 144 are excluded:</b><table>' +
  META.exclusionBreakdown.map(([reason, n]) => `<tr><td>${reason}</td><td>${n}</td></tr>`).join('') +
  '</table><p class="note">Of the 416 already tokened, only ' + META.model.comparables + ' carry a market cap of at least $1M and a TVL, so only those can price the model. The other ' + (META.model.comparablesAll - META.model.comparables) + ' record a token but carry no usable market cap, or one below $1M — an essentially untradeable token is not a price a new launch can be read off. Dropping them lifts the fitted multiple, so the values run high, not low.</p>';

const V = META.validation;
$('model').innerHTML = `
  <p>Huber robust fit on the ${META.model.comparables} launched protocols with a market cap of at least $1M and a TVL:
  log(market cap / TVL) = <b>${BETA[0].toFixed(2)}</b> (at $100M TVL)
  <b>${BETA[1].toFixed(2)}</b> × ln(TVL / $100M)
  <b>${BETA[2].toFixed(2)}</b> × ln(TVL / $100M)²
  <b>${BETA[3].toFixed(2)}</b> × age in years
  <b>${BETA[4].toFixed(2)}</b> × sibling,
  plus a category effect (≥3 launched peers). Size is the strongest term; a sibling — sharing a name stem with a protocol whose token trades — carries about ×${Math.exp(BETA[4]).toFixed(2)}. Growth and seasoning were tested and dropped.</p>
  <div class="kv">
    <div><b>×${V.loo} typical miss</b>Leave-one-out median error, as a factor. Flat-median baseline ×${V.baseline}.</div>
    <div><b>${Math.round(V.loo2 * 100)}% within ×2 · ${Math.round(V.loo3 * 100)}% within ×3</b>Launched protocols priced that closely, out of sample.</div>
    <div><b>×${V.wf} walk-forward</b>Fit before ${V.wfCut}, tested on the ${V.wfTest} after (${Math.round(V.wf2 * 100)}% within ×2).</div>
    <div><b>${Math.round(V.range2575 * 100)}% in P25–P75 · ${Math.round(V.range1090 * 100)}% in P10–P90</b>Range coverage, leave-one-out. (Ideal: 50% and 80%.)</div>
    <div><b>Odds: Brier ${V.oddsBrier} · AUC ${V.oddsAuc}</b>Logistic regression on log TVL, sibling and category, times a survival factor for age. Brier/AUC are the logistic part, leave-one-out; baseline Brier ${V.oddsBrierBase}, AUC 0.50.</div>
  </div>
  <p class="note">Ratios vary enormously even after the fit — a ×${V.loo} typical miss is honest, not precise. That is why every value is a range, and every rank carries a bootstrap range.</p>`;

function renderParams() {
  $('params').innerHTML = `<table class="params"><thead><tr><th>Parameter</th><th>Value</th><th>Source</th></tr></thead><tbody>` +
    [
      ['Deposit', '$' + controls.depositUsd.toLocaleString('en-US'), 'assumption', 'One fixed position, so every verdict is comparable.'],
      ['Drop share', (controls.dropShare * 100) + '% of launch value', 'assumption', 'Share of the token’s value the airdrop pays farmers.'],
      ['Horizon', PARAMS.horizonWeeks + ' weeks', 'assumption', 'How long the farm runs before the verdict is judged.'],
      ['Value of time', '$' + PARAMS.hourlyRateUsd + ' / hour', 'assumption', 'What an hour of the farmer’s time is worth.'],
      ['T-bill benchmark', (controls.tbillAnnual * 100) + '% a year', 'assumption', 'Risk-free return on the deposit; a verdict must beat it to be FARM.'],
      ['Exploit reserve', (PARAMS.exploitAnnual * 100) + '% of deposit a year', 'assumption', 'A slice of the deposit set aside for smart-contract risk.'],
      ['Gas per transaction', 'by chain, ~$0.01–$5.00', 'assumption', 'Rough cost of one onchain transaction.'],
      ['TVL, category, chains, age', 'per protocol', 'fact', 'From the snapshot. The only inputs that are not assumptions.'],
    ].map(([p, v, s, d]) =>
      `<tr><td><b>${p}</b><br><span class="note">${d}</span></td><td>${v}</td><td><span class="tag ${s === 'fact' ? 'fact' : 'assump'}">${s}</span></td></tr>`
    ).join('') + '</tbody></table>';
}
renderParams();

// ---- interactive farm controls ----

function syncControlInputs() {
  $('cDeposit').value = String(controls.depositUsd);
  $('cDrop').value = String(Math.round(controls.dropShare * 100));
  $('cTbill').value = String(Math.round(controls.tbillAnnual * 100));
}
function readControls() {
  const dep = Number($('cDeposit').value);
  const drop = Number($('cDrop').value) / 100;
  const tb = Number($('cTbill').value) / 100;
  controls.depositUsd = Number.isFinite(dep) && dep > 0 ? Math.round(dep) : PARAMS.depositUsd;
  controls.dropShare = Number.isFinite(drop) && drop > 0 && drop <= 1 ? drop : PARAMS.dropShare;
  controls.tbillAnnual = Number.isFinite(tb) && tb >= 0 && tb <= 1 ? tb : PARAMS.tbillAnnual;
  renderParams();
  renderBoard();
  const slug = new URLSearchParams(location.hash.slice(1)).get('slug');
  if (slug && BY_SLUG.has(slug)) showDetail(slug, true);
}
['cDeposit', 'cDrop', 'cTbill'].forEach((id) => $(id).addEventListener('input', readControls));
$('cReset').addEventListener('click', () => {
  controls.depositUsd = PARAMS.depositUsd;
  controls.dropShare = PARAMS.dropShare;
  controls.tbillAnnual = PARAMS.tbillAnnual;
  syncControlInputs();
  readControls();
});
syncControlInputs();

// ---- scatter: market cap vs TVL (log-log) ----
// Points are [log10 TVL, log10 market cap or implied value].

const SCAT = { show: 'both' };
function drawScatter() {
  const svg = $('scatter');
  if (!svg) return;
  const W = 640, H = 380, PAD = 44;
  let pts = [];
  if (SCAT.show === 'both' || SCAT.show === 'traded') pts = pts.concat(D.scatterTraded.map((p) => ({ x: p[0], y: p[1], kind: 'traded' })));
  if (SCAT.show === 'both' || SCAT.show === 'ranked') pts = pts.concat(D.scatterRanked.map((p) => ({ x: p[0], y: p[1], kind: 'ranked' })));
  if (!pts.length) { svg.innerHTML = '<text x="20" y="30">No points match the filter.</text>'; return; }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const xp = (x1 - x0) * 0.08 || 0.5, yp = (y1 - y0) * 0.08 || 0.5;
  x0 -= xp; x1 += xp; y0 -= yp; y1 += yp;
  const X = (v) => PAD + ((v - x0) / (x1 - x0)) * (W - PAD * 2);
  const Y = (v) => H - PAD - ((v - y0) / (y1 - y0)) * (H - PAD * 2);
  const curve = [];
  for (let i = 0; i <= 60; i++) {
    const lx = x0 + (i / 60) * (x1 - x0);
    const lnT = Math.log(10 ** lx / 100e6);
    const logMult = BETA[0] + BETA[1] * lnT + BETA[2] * lnT * lnT + BETA[3] * (MED_AGE / 365);
    curve.push([X(lx), Y(lx + logMult / Math.LN10)].join(','));
  }
  const fmtTick = (v) => {
    const n = 10 ** v;
    return n >= 1e9 ? '$' + (n / 1e9).toFixed(0) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(0) + 'M' : '$' + Math.round(n / 1e3) + 'K';
  };
  let s = '';
  for (let i = 0; i <= 4; i++) {
    const tx = x0 + (i / 4) * (x1 - x0), ty = y0 + (i / 4) * (y1 - y0);
    s += `<line x1="${X(tx)}" y1="${PAD}" x2="${X(tx)}" y2="${H - PAD}" stroke="currentColor" opacity="0.12"/><text x="${X(tx)}" y="${H - PAD + 18}" font-size="11" text-anchor="middle" fill="currentColor">${fmtTick(tx)}</text>`;
    s += `<line x1="${PAD}" y1="${Y(ty)}" x2="${W - PAD}" y2="${Y(ty)}" stroke="currentColor" opacity="0.12"/><text x="${PAD - 6}" y="${Y(ty) + 4}" font-size="11" text-anchor="end" fill="currentColor">${fmtTick(ty)}</text>`;
  }
  s += `<text x="${W / 2}" y="${H - 8}" font-size="11" text-anchor="middle" fill="currentColor">TVL (log scale)</text>`;
  s += `<text x="12" y="${H / 2}" font-size="11" text-anchor="middle" fill="currentColor" transform="rotate(-90 12 ${H / 2})">Market cap / value (log scale)</text>`;
  s += `<polyline points="${curve.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" opacity="0.55"/>`;
  for (const p of pts) {
    const cx = X(p.x).toFixed(1), cy = Y(p.y).toFixed(1);
    s += p.kind === 'traded'
      ? `<circle cx="${cx}" cy="${cy}" r="3" fill="currentColor" opacity="0.55"/>`
      : `<circle cx="${cx}" cy="${cy}" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.8"/>`;
  }
  s += `<text x="${W - PAD}" y="${PAD - 8}" font-size="11" text-anchor="end" fill="currentColor">● launched token ○ still to come — line: fitted size curve</text>`;
  svg.innerHTML = s;
}
$('sShow').addEventListener('change', () => { SCAT.show = $('sShow').value; drawScatter(); });
drawScatter();

// ---- board: filter, sort, render ----

const state = { q: '', cat: '', chain: '', verdict: '', sort: 'rank', dir: 1, rankMode: 'value' };
const SORTS = {
  rank: (r) => r.rank, name: (r) => r.name.toLowerCase(), category: (r) => r.category,
  chain: (r) => r.chains[0] || '', tvl: (r) => r.tvl, chg: (r) => r.chg ?? -999,
  odds: (r) => r.odds, value: (r) => r.value,
  expected: (r) => r.value * r.odds,
  verdict: (r) => econOf(r).verdict, net: (r) => econOf(r).net, perHr: (r) => econOf(r).perHour,
};
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = ROWS.filter((r) => {
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.verdict && econOf(r).verdict !== state.verdict) return false;
    if (q && !(r.name + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
  // Rank mode: value-if-launches is canonical (board.json). The switch
  // re-sorts the page by expected value instead; the board file is unchanged.
  const k = state.rankMode === 'expected' ? SORTS.expected : SORTS[state.sort];
  const dir = state.rankMode === 'expected' ? -1 : state.dir;
  list.sort((a, b) => {
    const va = k(a), vb = k(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c * dir || (a.rank - b.rank);
  });
  return list;
}
function renderBoard() {
  const list = filtered();
  $('count').textContent = list.length + ' of ' + ROWS.length + ' rows';
  const byExpected = state.rankMode === 'expected';
  $('rows').innerHTML = list.map((r, i) => {
    const e = econOf(r);
    const netCls = e.net >= 0 ? 'pos' : 'neg';
    const chains = r.chains.length > 1 ? r.chains[0] + ' +' + (r.chains.length - 1) : r.chains.join(', ');
    const shownRank = byExpected ? i + 1 : r.rank;
    const shownValue = byExpected ? r.value * r.odds : r.value;
    return `<tr data-slug="${r.slug}">
      <td>${shownRank}</td><td><b>${r.name}</b><br><span class="note">${r.slug}</span></td>
      <td>${r.category}</td><td>${chains}</td>
      <td class="num">${money(r.tvl)}</td>
      <td class="num">${r.chg === null ? '—' : (r.chg >= 0 ? '+' : '') + r.chg.toFixed(1) + '%'}</td>
      <td class="num">${Math.round(r.odds * 100)}%</td>
      <td class="num"><b>${money(shownValue)}</b>${byExpected ? `<br><span class="note">if launches ${money(r.value)}</span>` : ''}</td>
      <td><span class="pill ${e.verdict}">${e.verdict}</span></td>
      <td class="num ${netCls}">${e.net >= 0 ? '+' : '−'}$${Math.abs(Math.round(e.net)).toLocaleString('en-US')}</td>
      <td class="num ${netCls}">${e.perHour >= 0 ? '+' : '−'}$${Math.abs(Math.round(e.perHour))}</td>
    </tr>`;
  }).join('');
  document.querySelectorAll('#board th').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.k === state.sort);
  });
  $('rankNote').textContent = byExpected
    ? 'Ranked by expected value (value if it launches × token odds). The canonical ranking — and board.json — stays value if it launches.'
    : 'Value is the headline: what the token would be worth if it launches. Odds feed only the farm decision, never the ranking.';
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  state.q = h.get('q') || ''; state.cat = h.get('cat') || ''; state.chain = h.get('chain') || '';
  state.verdict = h.get('v') || ''; state.sort = h.get('sort') || 'rank'; state.dir = h.get('dir') === '-1' ? -1 : 1;
  state.rankMode = h.get('rankby') === 'expected' ? 'expected' : 'value';
  $('q').value = state.q; $('fCat').value = state.cat; $('fChain').value = state.chain; $('fVerdict').value = state.verdict;
  $('rankBy').value = state.rankMode;
}
function writeHash(extra) {
  const h = new URLSearchParams();
  if (state.q) h.set('q', state.q);
  if (state.cat) h.set('cat', state.cat);
  if (state.chain) h.set('chain', state.chain);
  if (state.verdict) h.set('v', state.verdict);
  if (state.sort !== 'rank') h.set('sort', state.sort);
  if (state.dir === -1) h.set('dir', '-1');
  if (state.rankMode === 'expected') h.set('rankby', 'expected');
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  history.replaceState(null, '', '#' + h.toString());
}
CATS.forEach((c) => { const o = document.createElement('option'); o.textContent = c; $('fCat').appendChild(o); });
CHAINS.forEach((c) => { const o = document.createElement('option'); o.textContent = c; $('fChain').appendChild(o); });
[['q', 'input', 'q'], ['fCat', 'change', 'cat'], ['fChain', 'change', 'chain'], ['fVerdict', 'change', 'verdict'], ['rankBy', 'change', 'rankMode']].forEach(([id, ev, key]) => {
  $(id).addEventListener(ev, () => { state[key] = $(id).value; writeHash(); renderBoard(); });
});
$('reset').addEventListener('click', () => {
  Object.assign(state, { q: '', cat: '', chain: '', verdict: '', sort: 'rank', dir: 1, rankMode: 'value' });
  $('q').value = ''; $('fCat').value = ''; $('fChain').value = ''; $('fVerdict').value = ''; $('rankBy').value = 'value';
  writeHash(); renderBoard();
});
document.querySelectorAll('#board th').forEach((th) => {
  th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = 1; }
    writeHash(); renderBoard();
  });
});
$('rows').addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-slug]');
  if (tr) showDetail(tr.dataset.slug);
});
$('back').addEventListener('click', () => {
  $('detailCard').hidden = true;
  writeHash();
  document.querySelector('.card .tablewrap').scrollIntoView({ block: 'nearest' });
});

// ---- detail view ----

function showDetail(slug, keepScroll) {
  const r = BY_SLUG.get(slug);
  if (!r) return;
  const t = termsOf(r);
  const e = econOf(r);
  const steps = farmSteps(protoOf(r), controls.depositUsd);
  const sens = farmSensitivity(protoOf(r), r.value, r.odds);
  const parts = [
    ['TVL', money(r.tvl)],
    ['Base multiple', '×' + Math.exp(t.base).toFixed(3)],
    ['Size factor', '×' + Math.exp(t.size).toFixed(2)],
    ['Size curve factor', '×' + Math.exp(t.size2).toFixed(2)],
    ['Age factor', '×' + Math.exp(t.age).toFixed(2)],
    ['Sibling factor', '×' + Math.exp(t.sibling).toFixed(2)],
    ['Category factor', '×' + Math.exp(t.category).toFixed(2)],
  ];
  // Range chart: log-scale whisker, lo10–hi90 with the P25–P75 band.
  const lo = Math.log(r.lo10), hi = Math.log(r.hi90), v = Math.log(r.value);
  const lo25 = Math.log(r.lo), hi75 = Math.log(r.hi);
  const pct = (x) => ((x - lo) / (hi - lo || 1)) * 100;
  const chart = `<svg viewBox="0 0 560 54" width="100%" height="54">    <line x1="8" y1="27" x2="552" y2="27" stroke="currentColor" stroke-width="2" opacity="0.35"/>
    <rect x="${8 + pct(lo25) * 5.44}" y="20" width="${Math.max(1, (pct(hi75) - pct(lo25)) * 5.44)}" height="14" fill="currentColor" opacity="0.18"/>
    <line x1="${8 + pct(lo) * 5.44}" y1="18" x2="${8 + pct(lo) * 5.44}" y2="36" stroke="currentColor" stroke-width="2"/>
    <line x1="${8 + pct(hi) * 5.44}" y1="18" x2="${8 + pct(hi) * 5.44}" y2="36" stroke="currentColor" stroke-width="2"/>
    <circle cx="${8 + pct(v) * 5.44}" cy="27" r="6" fill="currentColor"/>
    <text x="8" y="50" font-size="11" fill="currentColor">${money(r.lo10)}</text>
    <text x="552" y="50" font-size="11" text-anchor="end" fill="currentColor">${money(r.hi90)}</text>
    <text x="${8 + pct(v) * 5.44}" y="12" font-size="11" text-anchor="middle" fill="currentColor">${money(r.value)}</text>
  </svg>`;
  const beOdds = e.breakEvenOdds === null ? 'never — even at 100% odds the drop cannot cover the costs' : Math.round(e.breakEvenOdds * 100) + '% (model gives ' + Math.round(r.odds * 100) + '%)';
  const minTk = e.minTicket === null ? 'never — no deposit size turns this farm positive' : money(e.minTicket);
  $('detail').innerHTML = `<div class="detail">
    <h3>${r.name}</h3>
    <p class="note">#${r.rank} of ${ROWS.length} by implied value · rank ${r.rankLo}–${r.rankHigh} across the 200 bootstrap refits · ${r.category} · ${r.chains.join(', ')} · TVL ${money(r.tvl)} · ${ageFmt(r.age)} with no token</p>
    <p><span class="big">${money(r.value)}</span> <span class="note">if a token launches (P25–P75 ${money(r.lo)}–${money(r.hi)}; P10–P90 ${money(r.lo10)}–${money(r.hi90)}) · odds ${Math.round(r.odds * 100)}% · expected ${money(r.value * r.odds)}</span></p>
    ${chart}
    <h4>How the figure is made</h4>
    <table class="terms"><thead><tr><th>Term</th><th class="num">Factor</th></tr></thead><tbody>
      ${parts.map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`).join('')}
      <tr class="total"><td>Value if it launches</td><td class="num">${money(r.value)}</td></tr>
      <tr><td>× token odds</td><td class="num">${Math.round(r.odds * 100)}%</td></tr>
      <tr class="total"><td>Expected value</td><td class="num">${money(r.value * r.odds)}</td></tr>
    </tbody></table>
    <h4>Farm verdict: <span class="pill ${e.verdict}">${e.verdict}</span></h4>
    <div class="econ">
      <div><b>${e.net >= 0 ? '+' : '−'}$${Math.abs(Math.round(e.net)).toLocaleString('en-US')}</b>expected net payoff</div>
      <div><b>${e.perHour >= 0 ? '+' : '−'}$${Math.abs(Math.round(e.perHour))} / hour</b>net per hour</div>
      <div><b>$${Math.round(e.expectedDrop).toLocaleString('en-US')}</b>expected drop (${Math.round(r.odds * 100)}% × ${controls.dropShare * 100}% × ${money(r.value)} × ${money(controls.depositUsd)} / TVL)</div>
      <div><b>−$${e.gasTotal.toFixed(2)} gas · −$${Math.round(e.timeCost)} time · −$${Math.round(e.exploitReserve)} reserve</b>${e.minutes} min over ${PARAMS.horizonWeeks} weeks</div>
      <div><b>$${Math.round(e.benchmark)}</b>benchmark — ${money(controls.depositUsd)} in a ${controls.tbillAnnual * 100}% T-bill for ${PARAMS.horizonWeeks} weeks</div>
      <div><b>${beOdds}</b>break-even odds</div>
      <div><b>${minTk}</b>minimum ticket</div>
    </div>
    <p class="note">FARM when the net beats the T-bill benchmark, MARGINAL when positive but below it, SKIP when negative. Deposit, drop share, horizon, hourly rate, exploit reserve and gas are the assumptions above — TVL, category and chain are snapshot facts.</p>
    <h4>If the drop or ticket differ</h4>
    <table class="terms"><thead><tr><th>Drop share</th>${sens.tickets.map((tk) => `<th class="num">${money(tk)}</th>`).join('')}</tr></thead><tbody>
      ${sens.dropShares.map((ds, i) => `<tr><td>${(ds * 100).toFixed(1)}%</td>${sens.cells[i].map((c) => `<td class="num"><span class="pill ${c.verdict}">${c.verdict}</span> ${c.net >= 0 ? '+' : '−'}$${Math.abs(c.net).toLocaleString('en-US')}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <p class="note">Each cell recomputes the verdict and net at that drop share and ticket. The board's verdicts use the default ${money(PARAMS.depositUsd)} deposit and ${(PARAMS.dropShare * 100)}% drop share.</p>
    <h4>Farm plan — 9 steps on a ${money(controls.depositUsd)} deposit</h4>
    <ol class="steps">${steps.map((s) => `<li>${s.text}<span class="cost">Cost ${s.gasUsd > 0 ? '$' + s.gasUsd.toFixed(2) + ' in gas' : 'free'} · about ${s.minutes} minutes</span></li>`).join('')}</ol>
  </div>`;
  $('detailCard').hidden = false;
  if (!keepScroll) {
    writeHash({ slug });
    $('detailCard').scrollIntoView({ block: 'start' });
  }
}

readHash();
renderBoard();
const initialSlug = new URLSearchParams(location.hash.slice(1)).get('slug');
if (initialSlug && BY_SLUG.has(initialSlug)) showDetail(initialSlug);
