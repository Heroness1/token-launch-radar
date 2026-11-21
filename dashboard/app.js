// Token Launch Radar — board, filters, detail views. Data from data.js; farm steps
// and economics from farm.js (the same module main.ts uses); valuation terms are
// recomputed here from the fitted model, so the page agrees with board.json.
import { farmSteps, farmEconomics, PARAMS } from './farm.js';

const D = window.RADAR;
const META = D.meta, CATS = D.categories, CHAINS = D.chains;
const CAT_EFF = new Map(META.model.categoryEffect);
const BETA = META.model.beta;
const MED_AGE = META.model.medianAgeDays;
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 2).replace(/\.00$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}
function ageFmt(days) {
  if (days === null || days === undefined) return '—';
  if (days < 365) return days + ' d';
  return (days / 365).toFixed(1) + ' yr';
}
// Rows are compact arrays, with money figures in thousands of dollars:
// [slug, name, catIdx, chainIdxs, tvlK, chg, ageDays, odds, valueK, loK, hiK, rankLo, rankHi]
function rowObj(a) {
  return {
    slug: a[0], name: a[1], category: CATS[a[2]], chains: a[3].map((i) => CHAINS[i]),
    tvl: a[4] * 1000, chg: a[5], age: a[6], odds: a[7], value: a[8] * 1000, lo: a[9] * 1000, hi: a[10] * 1000,
    rankLo: a[11], rankHi: a[12],
  };
}
const ROWS = D.rows.map(rowObj);
const BY_SLUG = new Map(ROWS.map((r) => [r.slug, r]));
// The rank is the row's position in the value-sorted array data.js was built from.
ROWS.forEach((r, i) => { r.rank = i + 1; });

function protoOf(r) {
  return { slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl };
}
function econOf(r) {
  return farmEconomics(protoOf(r), r.value, r.odds);
}
function termsOf(r) {
  const lnT = Math.log(r.tvl / 100e6);
  const g = clamp(r.chg ?? 0, -30, 30) / 10;
  const ageY = (r.age ?? MED_AGE) / 365;
  const growthF = clamp(Math.exp(g * BETA[2]), 0.7, 1.4);
  return {
    base: BETA[0], size: lnT * BETA[1], growth: Math.log(growthF),
    age: ageY * BETA[3], category: CAT_EFF.get(r.category) ?? 0,
  };
}

// ---- header, ledger, model, params ----

$('metaLine').textContent =
  `Snapshot ${META.asOf} · floor ${money(META.floor)} · ${META.rows} ranked protocols · ` +
  `fit on ${META.model.comparables} launched peers · ranges from a 200-refit bootstrap.`;
$('kpis').innerHTML = [
  [META.ledger.ranked, 'ranked'],
  [META.ledger.tokened, 'already tokened'],
  [META.ledger.excluded, 'excluded'],
  ['×' + META.validation.loo, 'typical miss (LOO)'],
  [META.verdicts.FARM, 'FARM verdicts'],
].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');

const L = META.ledger, TOT = L.ranked + L.tokened + L.excluded;
$('ledger').innerHTML = [
  ['Ranked', L.ranked, 'no token recorded, passes the watchlist rule'],
  ['Already tokened', L.tokened, 'a gecko id, symbol or market cap is recorded'],
  ['Excluded', L.excluded, 'no token, but a wrapped / staked / bridged product'],
].map(([t, n, d]) =>
  `<div class="bucket"><b>${n}</b><span>${t} — ${d}</span><div class="bar"><i style="width:${(100 * n / TOT).toFixed(1)}%"></i></div></div>`
).join('');
$('excluded').innerHTML = '<b>Why the 144 are excluded:</b><table>' +
  META.exclusionBreakdown.map(([reason, n]) => `<tr><td>${reason}</td><td>${n}</td></tr>`).join('') +
  '</table><p class="note">Of the 416 already tokened, only 128 carry both a market cap and a TVL, so only those 128 can price the model. The other 288 record a token but carry no usable market cap.</p>';

const V = META.validation;
$('model').innerHTML = `
  <p>The multiple is fit by OLS on the 128 launched protocols with a market cap and TVL:
  log(market cap / TVL) = <b>${BETA[0].toFixed(2)}</b> (at $100M TVL)
  <b>${BETA[1].toFixed(2)}</b> × ln(TVL / $100M)
  <b>${BETA[2].toFixed(2)}</b> × (7-day growth / 10pp)
  <b>${BETA[3].toFixed(2)}</b> × age in years,
  plus a category effect that only counts when ≥3 launched peers support it.
  Size is the one term the data pins down (10× larger TVL carries about ×${Math.exp(BETA[1] * Math.log(10)).toFixed(2)} the multiple).
  Growth is weak and its factor is capped at ×0.7–×1.4; age barely moves the multiple — it matters for the token odds instead.</p>
  <div class="kv">
    <div><b>×${V.loo} typical miss</b>Leave-one-out: refit without each launched protocol and predict it. Median error, as a factor.</div>
    <div><b>${Math.round(V.loo2 * 100)}% within ×2 · ${Math.round(V.loo3 * 100)}% within ×3</b>Share of launched protocols priced that closely, out of sample.</div>
    <div><b>×${V.baseline} flat-median baseline</b>The same test using one median ratio for everything. The fit beats it.</div>
    <div><b>×${V.wf} walk-forward</b>Fit on protocols tracked before ${V.wfCut}, tested on the ${V.wfTest} tracked after (${Math.round(V.wf2 * 100)}% within ×2).</div>
  </div>
  <p class="note">Ratios vary enormously even after the fit — a ×${V.loo} typical miss is honest, not precise. That is why every value is a range, and every rank carries a bootstrap range.</p>`;

$('params').innerHTML = `<table class="params"><thead><tr><th>Parameter</th><th>Value</th><th>Source</th></tr></thead><tbody>` +
  [
    ['Deposit', '$' + PARAMS.depositUsd.toLocaleString('en-US'), 'assumption', 'One fixed position, so every verdict is comparable.'],
    ['Drop share', (PARAMS.dropShare * 100) + '% of launch value', 'assumption', 'Share of the token’s value the airdrop is assumed to pay farmers.'],
    ['Horizon', PARAMS.horizonWeeks + ' weeks', 'assumption', 'How long the farm runs before the verdict is judged.'],
    ['Value of time', '$' + PARAMS.hourlyRateUsd + ' / hour', 'assumption', 'What an hour of the farmer’s time is valued at.'],
    ['T-bill benchmark', (PARAMS.tbillAnnual * 100) + '% a year', 'assumption', 'Risk-free return on the deposit over the horizon; a verdict must beat it to be FARM.'],
    ['Gas per transaction', 'by chain, ~$0.01–$5.00', 'assumption', 'Rough cost of one onchain transaction on each chain.'],
    ['TVL, category, chains, age', 'per protocol', 'fact', 'From the snapshot. The only inputs that are not assumptions.'],
  ].map(([p, v, s, d]) =>
    `<tr><td><b>${p}</b><br><span class="note">${d}</span></td><td>${v}</td><td><span class="tag ${s === 'fact' ? 'fact' : 'assump'}">${s}</span></td></tr>`
  ).join('') + '</tbody></table>';

// ---- board: filter, sort, render ----

const state = { q: '', cat: '', chain: '', verdict: '', sort: 'rank', dir: 1 };
const SORTS = {
  rank: (r) => r.rank, name: (r) => r.name.toLowerCase(), category: (r) => r.category,
  chain: (r) => r.chains[0] || '', tvl: (r) => r.tvl, chg: (r) => r.chg ?? -999,
  odds: (r) => r.odds, value: (r) => r.value,
  verdict: (r) => econOf(r).verdict, net: (r) => econOf(r).net, perHr: (r) => econOf(r).perHour,
};
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = ROWS.filter((r) => {
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.verdict && econOf(r).verdict !== state.verdict) return false;
    if (q && !(r.name + ' ' + r.slug + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
  const k = SORTS[state.sort];
  list.sort((a, b) => {
    const va = k(a), vb = k(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c * state.dir || (a.rank - b.rank);
  });
  return list;
}
function renderBoard() {
  const list = filtered();
  $('count').textContent = list.length + ' of ' + ROWS.length + ' rows';
  $('rows').innerHTML = list.map((r) => {
    const e = econOf(r);
    const netCls = e.net >= 0 ? 'pos' : 'neg';
    const chains = r.chains.length > 1 ? r.chains[0] + ' +' + (r.chains.length - 1) : r.chains.join(', ');
    return `<tr data-slug="${r.slug}">
      <td>${r.rank}</td><td><b>${r.name}</b><br><span class="note">${r.slug}</span></td>
      <td>${r.category}</td><td>${chains}</td>
      <td class="num">${money(r.tvl)}</td>
      <td class="num">${r.chg === null ? '—' : (r.chg >= 0 ? '+' : '') + r.chg.toFixed(1) + '%'}</td>
      <td class="num">${Math.round(r.odds * 100)}%</td>
      <td class="num"><b>${money(r.value)}</b></td>
      <td><span class="pill ${e.verdict}">${e.verdict}</span></td>
      <td class="num ${netCls}">${e.net >= 0 ? '+' : '−'}$${Math.abs(Math.round(e.net)).toLocaleString('en-US')}</td>
      <td class="num ${netCls}">${e.perHour >= 0 ? '+' : '−'}$${Math.abs(Math.round(e.perHour))}</td>
    </tr>`;
  }).join('');
  document.querySelectorAll('#board th').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.k === state.sort);
  });
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  state.q = h.get('q') || ''; state.cat = h.get('cat') || ''; state.chain = h.get('chain') || '';
  state.verdict = h.get('v') || ''; state.sort = h.get('sort') || 'rank'; state.dir = h.get('dir') === '-1' ? -1 : 1;
  $('q').value = state.q; $('fCat').value = state.cat; $('fChain').value = state.chain; $('fVerdict').value = state.verdict;
}
function writeHash(extra) {
  const h = new URLSearchParams();
  if (state.q) h.set('q', state.q);
  if (state.cat) h.set('cat', state.cat);
  if (state.chain) h.set('chain', state.chain);
  if (state.verdict) h.set('v', state.verdict);
  if (state.sort !== 'rank') h.set('sort', state.sort);
  if (state.dir === -1) h.set('dir', '-1');
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  history.replaceState(null, '', '#' + h.toString());
}
CATS.forEach((c) => { const o = document.createElement('option'); o.textContent = c; $('fCat').appendChild(o); });
CHAINS.forEach((c) => { const o = document.createElement('option'); o.textContent = c; $('fChain').appendChild(o); });
$('q').addEventListener('input', () => { state.q = $('q').value; writeHash(); renderBoard(); });
$('fCat').addEventListener('change', () => { state.cat = $('fCat').value; writeHash(); renderBoard(); });
$('fChain').addEventListener('change', () => { state.chain = $('fChain').value; writeHash(); renderBoard(); });
$('fVerdict').addEventListener('change', () => { state.verdict = $('fVerdict').value; writeHash(); renderBoard(); });
$('reset').addEventListener('click', () => {
  Object.assign(state, { q: '', cat: '', chain: '', verdict: '', sort: 'rank', dir: 1 });
  $('q').value = ''; $('fCat').value = ''; $('fChain').value = ''; $('fVerdict').value = '';
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

function showDetail(slug) {
  const r = BY_SLUG.get(slug);
  if (!r) return;
  const t = termsOf(r);
  const e = econOf(r);
  const steps = farmSteps(protoOf(r));
  const peers = (D.peers[CATS.indexOf(r.category)] || []);
  const parts = [
    ['TVL', money(r.tvl), 'the protocol’s size, from the snapshot'],
    ['Base multiple', '×' + Math.exp(t.base).toFixed(3), 'the fitted multiple at $100M TVL'],
    ['Size factor', '×' + Math.exp(t.size).toFixed(2), 'larger TVL carries a smaller multiple — the fit’s strongest term'],
    ['Growth factor', '×' + Math.exp(t.growth).toFixed(2), r.chg === null ? '7-day change not reported, so no adjustment' : `7-day TVL ${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}% (capped at ×0.7–×1.4)`],
    ['Age factor', '×' + Math.exp(t.age).toFixed(2), r.age === null ? 'listing date not reported, so the median age is used' : `running ${ageFmt(r.age)} with no token recorded`],
    ['Category factor', '×' + Math.exp(t.category).toFixed(2), (CAT_EFF.get(r.category) ?? 0) === 0 ? `${r.category} has fewer than 3 launched peers, so no category effect is trusted` : `from the launched ${r.category} peers`],
  ];
  const logTerms = [['Size', t.size], ['Growth', t.growth], ['Age', t.age], ['Category', t.category]];
  logTerms.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const biggest = logTerms[0];
  const moves = biggest[1] === 0
    ? 'No single term moves it: every adjustment is near ×1.00, so the value is essentially the base multiple times the TVL.'
    : `What moves it most is <b>${biggest[0].toLowerCase()}</b> (×${Math.exp(Math.abs(biggest[1])).toFixed(2)} ${biggest[1] > 0 ? 'up' : 'down'}). ` +
      `Next is ${logTerms[1][0].toLowerCase()} (×${Math.exp(Math.abs(logTerms[1][1])).toFixed(2)}). ` +
      `A 10× larger TVL would move the value by about ×${Math.exp(BETA[1] * Math.log(10)).toFixed(2)} through size alone.`;
  // Range chart: log-scale whisker from lo to hi with the point value marked.
  const lo = Math.log(r.lo), hi = Math.log(r.hi), v = Math.log(r.value);
  const pct = (x) => ((x - lo) / (hi - lo || 1)) * 100;
  const chart = `<svg viewBox="0 0 560 54" width="100%" height="54" role="img" aria-label="Value range">
    <line x1="8" y1="27" x2="552" y2="27" stroke="currentColor" stroke-width="2" opacity="0.35"/>
    <line x1="${8 + pct(lo) * 5.44}" y1="18" x2="${8 + pct(lo) * 5.44}" y2="36" stroke="currentColor" stroke-width="2"/>
    <line x1="${8 + pct(hi) * 5.44}" y1="18" x2="${8 + pct(hi) * 5.44}" y2="36" stroke="currentColor" stroke-width="2"/>
    <circle cx="${8 + pct(v) * 5.44}" cy="27" r="6" fill="currentColor"/>
    <text x="8" y="50" font-size="11" fill="currentColor">${money(r.lo)}</text>
    <text x="552" y="50" font-size="11" text-anchor="end" fill="currentColor">${money(r.hi)}</text>
    <text x="${8 + pct(v) * 5.44}" y="12" font-size="11" text-anchor="middle" fill="currentColor">${money(r.value)}</text>
  </svg>`;
  $('detail').innerHTML = `<div class="detail">
    <h3>${r.name}</h3>
    <p class="note">#${r.rank} of ${ROWS.length} by implied value · rank ${r.rankLo}–${r.rankHi} across the 200 bootstrap refits · ${r.category} · ${r.chains.join(', ')} · TVL ${money(r.tvl)} · ${ageFmt(r.age)} with no token recorded</p>
    <p><span class="big">${money(r.value)}</span> <span class="note">if a token launches (range ${money(r.lo)}–${money(r.hi)}) · token odds ${Math.round(r.odds * 100)}% · expected value ${money(r.value * r.odds)}</span></p>
    ${chart}
    <h4>How the figure is made — term by term</h4>
    <table class="terms"><thead><tr><th>Term</th><th class="num">Factor</th><th>Where it comes from</th></tr></thead><tbody>
      ${parts.map(([a, b, c]) => `<tr><td>${a}</td><td class="num">${b}</td><td>${c}</td></tr>`).join('')}
      <tr class="total"><td>Value if it launches</td><td class="num">${money(r.value)}</td><td>TVL × base × size × growth × age × category</td></tr>
      <tr><td>× token odds</td><td class="num">${Math.round(r.odds * 100)}%</td><td>share of same-category protocols that record a token, reduced for older protocols with no token yet</td></tr>
      <tr class="total"><td>Expected value</td><td class="num">${money(r.value * r.odds)}</td><td>what the launch would be worth on average, if it ever happens — not the headline, and not the ranking</td></tr>
    </tbody></table>
    <h4>What moves it most</h4>
    <p>${moves}</p>
    <h4>Farm verdict: <span class="pill ${e.verdict}">${e.verdict}</span></h4>
    <div class="econ">
      <div><b>${e.net >= 0 ? '+' : '−'}$${Math.abs(Math.round(e.net)).toLocaleString('en-US')}</b>expected net payoff</div>
      <div><b>${e.perHour >= 0 ? '+' : '−'}$${Math.abs(Math.round(e.perHour))} / hour</b>net per hour of effort</div>
      <div><b>$${Math.round(e.expectedDrop).toLocaleString('en-US')}</b>expected drop (${Math.round(r.odds * 100)}% odds × ${PARAMS.dropShare * 100}% share × ${money(r.value)} × ${money(PARAMS.depositUsd)} / TVL)</div>
      <div><b>−$${e.gasTotal.toFixed(2)} gas · −$${Math.round(e.timeCost)} time</b>${e.minutes} minutes over ${PARAMS.horizonWeeks} weeks</div>
      <div><b>$${Math.round(e.benchmark)}</b>benchmark — the same ${money(PARAMS.depositUsd)} in a ${PARAMS.tbillAnnual * 100}% T-bill for ${PARAMS.horizonWeeks} weeks</div>
    </div>
    <p class="note">Verdict: FARM when the net beats the T-bill benchmark, MARGINAL when it is positive but does not, SKIP when it is negative. Deposit, drop share, horizon, hourly rate and gas are the assumptions above — TVL, category and chain are snapshot facts.</p>
    <h4>Farm plan — 10 steps on a ${money(PARAMS.depositUsd)} deposit</h4>
    <ol class="steps">${steps.map((s) => `<li>${s.text}<span class="cost">Cost ${s.gasUsd > 0 ? '$' + s.gasUsd.toFixed(2) + ' in gas' : 'free'} · about ${s.minutes} minutes</span></li>`).join('')}</ol>
    <h4>Launched ${r.category} protocols with a token price</h4>
    ${peers.length ? `<table class="terms"><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Cap / TVL</th></tr></thead><tbody>
      ${peers.map(([n, mc, tv]) => `<tr><td>${n}</td><td class="num">${money(mc * 1000)}</td><td class="num">${money(tv * 1000)}</td><td class="num">×${(mc / tv).toFixed(2)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="note">No launched peer in this category carries both a market cap and a TVL, so the value rests on the global model alone.</p>'}
  </div>`;
  $('detailCard').hidden = false;
  writeHash({ slug });
  $('detailCard').scrollIntoView({ block: 'start' });
}

readHash();
renderBoard();
const initialSlug = new URLSearchParams(location.hash.slice(1)).get('slug');
if (initialSlug && BY_SLUG.has(initialSlug)) showDetail(initialSlug);
