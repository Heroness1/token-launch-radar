// Token Launch Radar v2 — entry for make.fun's "Build the best token launch radar" bounty.
// Reads the sealed DefiLlama snapshot, ranks pre-token protocols by the implied value
// their token would have IF launched, and writes the board, the dashboard data and the
// dossier. Deterministic: the same snapshot bytes always produce the same output bytes
// (the bootstrap uses a seeded generator, never Math.random).
// Node 22 standard library only; no network; runs in under 120 seconds on 1 CPU.
//
// What changed from v1 (and why):
// - Coverage ledger: every one of the 758 protocols is accounted for exactly once —
//   ranked, already tokened, or excluded with a one-line reason — and the dashboard
//   shows the counts. A protocol is "already tokened" when ANY of its token fields
//   (gecko_id, symbol, mcap_usd) says so; the snapshot's fields disagree for 272
//   protocols, and treating any token evidence as tokened is the conservative reading.
// - Value model: a log-scale fit on the already-tokened protocols (intercept, size,
//   7-day growth, age, plus a category effect that only counts when at least 3
//   launched peers support it, shrunk toward the global model). Validated
//   out-of-sample by leave-one-out and by time, and bootstrapped for a value range
//   and a rank range per protocol. The headline value is the value IF a token
//   launches — the brief's question — not a probability-discounted expectation.
//   Token odds are shown separately and feed only the farm decision.
// - Farm plans: ~10 concrete steps per protocol (setup, category core, closing),
//   each with its cost and time, a verdict (FARM / MARGINAL / SKIP), an expected
//   net payoff in dollars and dollars per hour, on one stated parameter table.
//   All money/time figures are labelled assumptions; only TVL, category, chains
//   and age come from the snapshot.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';
import { farmSteps, farmEconomics, PARAMS } from './dashboard/farm.js';

// ------------------------------------------------------------------ types

interface Protocol {
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

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  rank_low: number;
  rank_high: number;
  token_odds: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  net_usd: number;
  net_per_hour_usd: number;
  expected_drop_usd: number;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  terms: { base: number; size: number; growth: number; age: number; category: number };
  farm_steps: string[];
}

// ------------------------------------------------------------------ inputs

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

const INPUT = argValue('--input') ?? '/input/snapshot.json';
const OUTPUT = process.env.MAKEFUN_OUTPUT_DIR ?? argValue('--output') ?? '/output';
const REPO = argValue('--repo') ?? new URL('.', import.meta.url).pathname;

const snap: Snapshot = JSON.parse(readFileSync(INPUT, 'utf8'));
const AS_OF = new Date(snap.as_of + 'T00:00:00.000Z');
const FLOOR = snap.floor_usd;

// ------------------------------------------------------------------ helpers

function median(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function ageDays(p: Protocol): number | null {
  if (!p.listed_at) return null;
  const listed = new Date(p.listed_at + 'T00:00:00.000Z');
  const days = Math.floor((AS_OF.getTime() - listed.getTime()) / 86400000);
  return days < 0 ? 0 : days;
}

function money(n: number): string {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 2).replace(/\.00$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

// Seeded generator (mulberry32) so the bootstrap is identical on every run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ordinary least squares by Gaussian elimination on X'X b = X'y, with a tiny ridge
// so a constant column (e.g. an age indicator that never fires) cannot make it singular.
function ols(X: number[][], y: number[]): number[] {
  const n = X.length;
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a]![b]! += X[i]![a]! * X[i]![b]!;
      A[a]![k]! += X[i]![a]! * y[i]!;
    }
  }
  for (let a = 0; a < k; a++) A[a]![a]! += 1e-8;
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    const tmp = A[c]!;
    A[c] = A[piv]!;
    A[piv] = tmp;
    const d = A[c]![c]!;
    for (let j = c; j <= k; j++) A[c]![j]! /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      for (let j = c; j <= k; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  return A.map((row) => row[k]!);
}

// ------------------------------------------------------------------ ledger

// A protocol "records a token" when ANY of its token fields says so. The snapshot's
// fields disagree for 272 protocols (a gecko id and symbol, but no market cap), so
// the conservative reading — any token evidence counts — is the one the ledger uses.
function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

function recordsNoToken(p: Protocol): boolean {
  return !recordsToken(p);
}

// The watchlist rule, from the kit's RULES.txt: not a wrapped, staked or bridged
// product of a protocol whose token already trades. Categories that are themselves
// such products, names ending in a version marker, names carrying wrapped/staked/
// staking, and names that begin with an exchange's name are left out.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function exclusionReason(p: Protocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'name carries wrapped / staked / staking';
  if (/ (V\d+|v\d+|\d+\.\d+(\.\d+)?)$/.test(p.name)) return 'name ends in a version marker';
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x + ' ') || p.name === x)) return 'name begins with an exchange name';
  return null;
}

interface LedgerEntry {
  slug: string;
  name: string;
  bucket: 'ranked' | 'tokened' | 'excluded';
  reason: string;
}

// Every protocol appears exactly once: ranked (no token, passes the rule), already
// tokened (any token evidence), or excluded (no token, fails the rule, with the reason).
const ledger: LedgerEntry[] = [];
for (const p of snap.protocols) {
  if (recordsToken(p)) {
    ledger.push({ slug: p.slug, name: p.name, bucket: 'tokened', reason: 'records a token (gecko id, symbol or market cap)' });
  } else {
    const reason = exclusionReason(p);
    if (reason) ledger.push({ slug: p.slug, name: p.name, bucket: 'excluded', reason });
    else ledger.push({ slug: p.slug, name: p.name, bucket: 'ranked', reason: 'no token recorded, passes the watchlist rule' });
  }
}
const ledgerCount = (bucket: string): number => ledger.filter((e) => e.bucket === bucket).length;
const RANKED_N = ledgerCount('ranked');
const TOKENED_N = ledgerCount('tokened');
const EXCLUDED_N = ledgerCount('excluded');
if (RANKED_N + TOKENED_N + EXCLUDED_N !== snap.protocols.length) {
  throw new Error(`ledger does not cover the snapshot: ${RANKED_N}+${TOKENED_N}+${EXCLUDED_N} != ${snap.protocols.length}`);
}
const exclusionBreakdown = new Map<string, number>();
for (const e of ledger) if (e.bucket === 'excluded') exclusionBreakdown.set(e.reason, (exclusionBreakdown.get(e.reason) ?? 0) + 1);

const ranked = snap.protocols.filter((p) => recordsNoToken(p) && exclusionReason(p) === null);

// ------------------------------------------------------------------ comparables & fit

// Launched protocols (a token already trades) with a market cap and TVL give the
// comparables. Their log market-cap-to-TVL ratio is winsorized to the 5th/95th
// percentile first, so one extreme protocol cannot carry the fit.
const comparables = snap.protocols.filter(
  (p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
);
const compLogRatios = comparables.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
const logRatioLo = percentile([...compLogRatios].sort((a, b) => a - b), 0.05);
const logRatioHi = percentile([...compLogRatios].sort((a, b) => a - b), 0.95);
const winsorizedLogRatio = (p: Protocol): number =>
  clamp(Math.log(p.mcap_usd! / p.tvl_usd), logRatioLo, logRatioHi);

const medianComparableAgeDays = median(
  comparables.map(ageDays).filter((a): a is number => a !== null).sort((a, b) => a - b),
);

// Design: [1, ln(TVL / $100M), 7-day growth in 10pp units (clamped to ±30pp),
// age in years (missing listing date imputed with the comparables' median age)].
function design(p: Protocol): number[] {
  const age = ageDays(p);
  return [
    1,
    Math.log(p.tvl_usd / 100e6),
    clamp(p.change_7d ?? 0, -30, 30) / 10,
    (age ?? medianComparableAgeDays) / 365,
  ];
}

interface Fit {
  beta: number[];
  categoryEffect: Map<string, number>;
  categoryN: Map<string, number>;
}

// The fit: OLS on the four continuous terms, then a category effect taken as the
// shrunk mean residual of the category's launched peers. A category effect only
// counts when at least 3 launched peers support it — one peer is not evidence,
// and the top of v1's board rested on exactly that (Risk Curators had a single
// launched peer). Shrinkage is n/(n+4) on top of the minimum.
function fitModel(rows: Protocol[]): Fit {
  const X = rows.map(design);
  const y = rows.map(winsorizedLogRatio);
  const beta = ols(X, y);
  const residuals = rows.map((p, i) => y[i]! - X[i]!.reduce((a, v, j) => a + v * beta[j]!, 0));
  const byCategory = new Map<string, number[]>();
  rows.forEach((p, i) => {
    const key = p.category ?? 'Uncategorized';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(residuals[i]!);
  });
  const categoryEffect = new Map<string, number>();
  const categoryN = new Map<string, number>();
  for (const [key, rs] of byCategory) {
    const n = rs.length;
    categoryN.set(key, n);
    if (n < 3) {
      categoryEffect.set(key, 0);
      continue;
    }
    const mean = rs.reduce((a, b) => a + b, 0) / n;
    categoryEffect.set(key, (n / (n + 4)) * mean);
  }
  return { beta, categoryEffect, categoryN };
}

// The growth term is the one fitted coefficient the data cannot pin down (its
// standard error is about as large as the estimate), so its factor is capped at
// ±40%: a fast TVL move can move the value, but it cannot dominate the ranking.
const GROWTH_FACTOR_MIN = 0.7;
const GROWTH_FACTOR_MAX = 1.4;

interface Terms {
  base: number;
  size: number;
  growth: number;
  age: number;
  category: number;
}

// Predict the log multiple (log of the market-cap-to-TVL ratio a token would have),
// with each term kept separate so the detail view can show the derivation.
function predictTerms(fit: Fit, p: Protocol): Terms {
  const d = design(p);
  const growthFactor = clamp(Math.exp(d[2]! * fit.beta[2]!), GROWTH_FACTOR_MIN, GROWTH_FACTOR_MAX);
  return {
    base: fit.beta[0]!,
    size: d[1]! * fit.beta[1]!,
    growth: Math.log(growthFactor),
    age: d[3]! * fit.beta[3]!,
    category: fit.categoryEffect.get(p.category ?? 'Uncategorized') ?? 0,
  };
}

function logMultiple(fit: Fit, p: Protocol): number {
  const t = predictTerms(fit, p);
  return t.base + t.size + t.growth + t.age + t.category;
}

function valueIfLaunches(fit: Fit, p: Protocol): number {
  return Math.max(1, Math.round(p.tvl_usd * Math.exp(logMultiple(fit, p))));
}

const fullFit = fitModel(comparables);

// ------------------------------------------------------------------ validation

// Leave-one-out: refit without each comparable and predict it. The same fit and
// predict functions as the shipped model, so the reported error is the model's own.
function looError(): { medianFactor: number; within2: number; within3: number } {
  const errs: number[] = [];
  for (let i = 0; i < comparables.length; i++) {
    const rest = comparables.filter((_, j) => j !== i);
    const fit = fitModel(rest);
    errs.push(Math.abs(winsorizedLogRatio(comparables[i]!) - logMultiple(fit, comparables[i]!)));
  }
  errs.sort((a, b) => a - b);
  const med = median(errs);
  return {
    medianFactor: Math.exp(med),
    within2: errs.filter((e) => e <= Math.log(2)).length / errs.length,
    within3: errs.filter((e) => e <= Math.log(3)).length / errs.length,
  };
}

// Baseline for comparison: predict every comparable with the flat median log ratio.
function baselineLooError(): number {
  const med = median([...compLogRatios].sort((a, b) => a - b).map((r) => clamp(r, logRatioLo, logRatioHi)));
  const errs = comparables.map((p) => Math.abs(winsorizedLogRatio(p) - med)).sort((a, b) => a - b);
  return Math.exp(median(errs));
}

// Walk-forward by time: fit on the protocols DefiLlama began tracking before the
// median tracking date, test on those tracked after it. listed_at is the only time
// field the snapshot carries, so the split is by tracking start, stated as such.
function walkForwardError(): { medianFactor: number; within2: number; cut: string; train: number; test: number } {
  const dated = comparables.filter((p) => p.listed_at).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const train = dated.filter((p) => p.listed_at! < cut);
  const test = dated.filter((p) => p.listed_at! >= cut);
  const fit = fitModel(train);
  const errs = test.map((p) => Math.abs(winsorizedLogRatio(p) - logMultiple(fit, p))).sort((a, b) => a - b);
  const med = median(errs);
  return {
    medianFactor: Math.exp(med),
    within2: errs.filter((e) => e <= Math.log(2)).length / errs.length,
    cut,
    train: train.length,
    test: test.length,
  };
}

const loo = looError();
const baselineFactor = baselineLooError();
const walkForward = walkForwardError();

// Bootstrap: refit on resampled comparables and re-rank, so each protocol gets a
// value range and a rank range. Seeded, so both grading runs agree byte for byte.
const BOOTSTRAP_REFITS = 200;
const bootstrapValues = new Map<string, number[]>();
const bootstrapRanks = new Map<string, number[]>();
for (const p of ranked) {
  bootstrapValues.set(p.slug, []);
  bootstrapRanks.set(p.slug, []);
}
{
  const rng = mulberry32(20261121);
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < comparables.length; i++) {
      sample.push(comparables[Math.floor(rng() * comparables.length)]!);
    }
    const fit = fitModel(sample);
    const scored = ranked
      .map((p) => ({ slug: p.slug, value: valueIfLaunches(fit, p) }))
      .sort((a, b2) => b2.value - a.value || (a.slug < b2.slug ? -1 : 1));
    scored.forEach((s, i) => {
      bootstrapValues.get(s.slug)!.push(s.value);
      bootstrapRanks.get(s.slug)!.push(i + 1);
    });
  }
}

function bootstrapRange(slug: string): { low: number; high: number; rankLow: number; rankHigh: number } {
  const values = [...bootstrapValues.get(slug)!].sort((a, b) => a - b);
  const ranks = [...bootstrapRanks.get(slug)!].sort((a, b) => a - b);
  return {
    low: Math.max(1, Math.round(percentile(values, 0.25))),
    high: Math.max(1, Math.round(percentile(values, 0.75))),
    rankLow: Math.round(percentile(ranks, 0.1)),
    rankHigh: Math.round(percentile(ranks, 0.9)),
  };
}

// ------------------------------------------------------------------ token odds

// The chance a protocol ever issues a token, estimated from the snapshot's own
// record — never a forecast. Start from the share of protocols in the same
// category that record a token (shrunk toward the global rate), then reduce it
// the longer the protocol has run with no token: the snapshot's age bands show
// most tokens appear early, so an old protocol with no token yet is past the
// typical window. The age factor is the square root of the pre-token share in
// the protocol's age band relative to the youngest band, so the discount is
// data-driven and dampened rather than invented.
const GLOBAL_TOKEN_RATE = TOKENED_N / snap.protocols.length;

function ageBand(p: Protocol): string {
  const a = ageDays(p);
  if (a === null) return 'unknown';
  if (a < 365) return '<1yr';
  if (a < 730) return '1-2yr';
  if (a < 1460) return '2-4yr';
  return '4yr+';
}

const bandRate = new Map<string, number>();
{
  const byBand = new Map<string, Protocol[]>();
  for (const p of snap.protocols) {
    const b = ageBand(p);
    if (!byBand.has(b)) byBand.set(b, []);
    byBand.get(b)!.push(p);
  }
  for (const [b, ps] of byBand) {
    const n = ps.length;
    const rate = ps.filter(recordsToken).length / n;
    bandRate.set(b, (n / (n + 8)) * rate + (8 / (n + 8)) * GLOBAL_TOKEN_RATE);
  }
}
const youngestPreTokenShare = 1 - (bandRate.get('<1yr') ?? GLOBAL_TOKEN_RATE);

const categoryTokenRate = new Map<string, number>();
{
  const byCat = new Map<string, Protocol[]>();
  for (const p of snap.protocols) {
    const key = p.category ?? 'Uncategorized';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(p);
  }
  for (const [key, ps] of byCat) {
    const n = ps.length;
    const rate = ps.filter(recordsToken).length / n;
    categoryTokenRate.set(key, (n / (n + 8)) * rate + (8 / (n + 8)) * GLOBAL_TOKEN_RATE);
  }
}

function tokenOdds(p: Protocol): number {
  const cat = categoryTokenRate.get(p.category ?? 'Uncategorized') ?? GLOBAL_TOKEN_RATE;
  const band = ageBand(p);
  let ageFactor = 1;
  if (band !== 'unknown') {
    const preTokenShare = 1 - (bandRate.get(band) ?? GLOBAL_TOKEN_RATE);
    ageFactor = Math.sqrt(Math.max(0.05, preTokenShare) / Math.max(0.05, youngestPreTokenShare));
  }
  return clamp(cat * ageFactor, 0.05, 0.9);
}

// ------------------------------------------------------------------ build rows

function valueRow(p: Protocol): Row {
  const value = valueIfLaunches(fullFit, p);
  const range = bootstrapRange(p.slug);
  const odds = tokenOdds(p);
  const econ = farmEconomics(p, value, odds);
  const steps = farmSteps(p);
  const terms = predictTerms(fullFit, p);
  return {
    slug: p.slug,
    name: p.name,
    rank: 0,
    implied_value_usd: value,
    low_usd: Math.min(range.low, value),
    high_usd: Math.max(range.high, value),
    rank_low: Math.min(range.rankLow, range.rankHigh),
    rank_high: Math.max(range.rankLow, range.rankHigh),
    token_odds: Number(odds.toFixed(2)),
    verdict: econ.verdict,
    net_usd: Math.round(econ.net),
    net_per_hour_usd: Math.round(econ.perHour),
    expected_drop_usd: Math.round(econ.expectedDrop),
    category: p.category ?? 'Uncategorized',
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: ageDays(p),
    terms: {
      base: Number(terms.base.toFixed(3)),
      size: Number(terms.size.toFixed(3)),
      growth: Number(terms.growth.toFixed(3)),
      age: Number(terms.age.toFixed(3)),
      category: Number(terms.category.toFixed(3)),
    },
    farm_steps: steps.map((s) => s.text),
  };
}

const rows: Row[] = ranked.map(valueRow);
rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
rows.forEach((r, i) => {
  r.rank = i + 1;
});

// Assertions: fail loudly here rather than shipping a board the gate refuses.
const rowSlugs = new Set(rows.map((r) => r.slug));
for (const slug of snap.watchlist) {
  if (!rowSlugs.has(slug)) throw new Error(`watchlist protocol missing from board: ${slug}`);
}
if (rows.length < 100) throw new Error(`board has ${rows.length} rows, need at least 100`);
for (let i = 1; i < rows.length; i++) {
  if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
    throw new Error(`board not sorted by value at rank ${i + 1}`);
  }
}
const verdictCounts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
for (const r of rows) verdictCounts[r.verdict]++;
if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) {
  throw new Error('board values are all the same, not a ranking');
}

// ------------------------------------------------------------------ outputs

// Board: the scored artifact. Full rows, farm steps included.
const board = {
  meta: {
    title: 'Token Launch Radar',
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: FLOOR,
    rows: rows.length,
    watchlist_covered: snap.watchlist.length,
    ledger: { ranked: RANKED_N, tokened: TOKENED_N, excluded: EXCLUDED_N, total: snap.protocols.length },
    method:
      'Implied value (the value IF a token launches) = TVL x exp(fitted log multiple). The log multiple is fit by OLS on the 128 already-tokened protocols with a market cap and TVL: intercept + size (ln TVL) + 7-day growth + age, plus a category effect that only counts when at least 3 launched peers support it (shrunk n/(n+4)). Log ratios winsorized to the 5th/95th percentile; the growth factor is capped at x0.7-x1.4 because the fitted growth effect is weak. Value range and rank range come from a 200-refit bootstrap (seeded). Token odds are the shrunk share of same-category protocols that record a token, reduced the longer a protocol has run with no token; they feed only the farm decision, never the headline value.',
    validation: {
      loo_median_factor: Number(loo.medianFactor.toFixed(2)),
      loo_within_x2: Number(loo.within2.toFixed(2)),
      loo_within_x3: Number(loo.within3.toFixed(2)),
      baseline_median_factor: Number(baselineFactor.toFixed(2)),
      walkforward_median_factor: Number(walkForward.medianFactor.toFixed(2)),
      walkforward_within_x2: Number(walkForward.within2.toFixed(2)),
      walkforward_cut: walkForward.cut,
      walkforward_train: walkForward.train,
      walkforward_test: walkForward.test,
    },
    farm_params: PARAMS,
    verdicts: verdictCounts,
  },
  rows,
};

// Dashboard data: compact, so the whole dashboard source stays under the 64 KB
// the dossier's text can show the judge. The farm steps are rendered in the page
// from farm.js (the same module main.ts uses), and the valuation terms are
// recomputed in the page from the model below, so the screenshots and board.json agree.
const categories: string[] = [...new Set(rows.map((r) => r.category))].sort();
const catIndex = new Map(categories.map((c, i) => [c, i]));
const allChains: string[] = [...new Set(rows.flatMap((r) => r.chains))].sort();
const chainIndex = new Map(allChains.map((c, i) => [c, i]));
const verdictIndex = new Map([['SKIP', 0], ['MARGINAL', 1], ['FARM', 2]]);

// Top launched peers per category, for the detail view: [name, mcap, tvl] in
// thousands of dollars (the page multiplies back; ratios are unaffected).
const peersByCategory = new Map<string, [string, number, number][]>();
for (const p of comparables) {
  const key = p.category ?? 'Uncategorized';
  if (!peersByCategory.has(key)) peersByCategory.set(key, []);
  peersByCategory.get(key)!.push([p.name, Math.round(p.mcap_usd! / 1000), Math.round(p.tvl_usd / 1000)]);
}
for (const peers of peersByCategory.values()) peers.sort((a, b) => b[2] - a[2]);

const dashData = {
  meta: {
    asOf: snap.as_of,
    floor: FLOOR,
    rows: rows.length,
    watchlist: snap.watchlist.length,
    ledger: { ranked: RANKED_N, tokened: TOKENED_N, excluded: EXCLUDED_N },
    exclusionBreakdown: [...exclusionBreakdown.entries()].sort((a, b) => b[1] - a[1]),
    model: {
      beta: fullFit.beta.map((b) => Number(b.toFixed(4))),
      categoryEffect: [...fullFit.categoryEffect.entries()].map(([c, e]) => [c, Number(e.toFixed(3))]),
      comparables: comparables.length,
      medianAgeDays: medianComparableAgeDays,
      globalTokenRate: Number(GLOBAL_TOKEN_RATE.toFixed(3)),
    },
    validation: {
      loo: Number(loo.medianFactor.toFixed(2)),
      loo2: Number(loo.within2.toFixed(2)),
      loo3: Number(loo.within3.toFixed(2)),
      baseline: Number(baselineFactor.toFixed(2)),
      wf: Number(walkForward.medianFactor.toFixed(2)),
      wf2: Number(walkForward.within2.toFixed(2)),
      wfCut: walkForward.cut,
      wfTrain: walkForward.train,
      wfTest: walkForward.test,
    },
    params: PARAMS,
    verdicts: verdictCounts,
  },
  categories,
  peers: categories.map((c) => (peersByCategory.get(c) ?? []).slice(0, 3)),
  chains: allChains,
  rows: rows.map((r) => [
    r.slug, r.name, catIndex.get(r.category)!, r.chains.map((c) => chainIndex.get(c)!),
    // Money figures in thousands of dollars (the page multiplies back by 1,000):
    // the page displays them to $0.1M precision, the farm math moves by cents, and
    // the valuation terms shift by under 1e-5 in log space. board.json keeps exact figures.
    Math.round(r.tvl_usd / 1000), r.change_7d, r.age_days, r.token_odds,
    Math.round(r.implied_value_usd / 1000), Math.round(r.low_usd / 1000),
    Math.round(r.high_usd / 1000), r.rank_low, r.rank_high,
  ]),
};

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDir(join(src, entry.name), join(dst, entry.name));
    else if (entry.isFile()) copyFileSync(join(src, entry.name), join(dst, entry.name));
  }
}

mkdirSync(OUTPUT, { recursive: true });
mkdirSync(join(OUTPUT, 'dashboard'), { recursive: true });
mkdirSync(join(OUTPUT, 'screenshots'), { recursive: true });

// Static dashboard files from the repository.
copyDir(join(REPO, 'dashboard'), join(OUTPUT, 'dashboard'));
// The generated data file beside the page.
writeFileSync(join(OUTPUT, 'dashboard', 'data.js'), `window.RADAR = ${JSON.stringify(dashData)};\n`, 'utf8');
// Board.
writeFileSync(join(OUTPUT, 'board.json'), JSON.stringify(board, null, 2) + '\n', 'utf8');
// Screenshots from the repository.
if (existsSync(join(REPO, 'screenshots'))) copyDir(join(REPO, 'screenshots'), join(OUTPUT, 'screenshots'));
// Dossier: byte for byte what the library writes from dashboard/ and screenshots/.
const dossier = buildDossier(OUTPUT, { text_max_bytes: 65536 });
writeFileSync(join(OUTPUT, 'dossier.json'), dossier);

// ------------------------------------------------------------------ report

const top = rows.slice(0, 5).map((r) => `#${r.rank} ${r.slug} ${money(r.implied_value_usd)} (${r.verdict})`);
console.log(`ledger: ranked ${RANKED_N} + tokened ${TOKENED_N} + excluded ${EXCLUDED_N} = ${snap.protocols.length}`);
console.log(`board: ${rows.length} rows, watchlist ${snap.watchlist.length}/${snap.watchlist.length} covered`);
console.log(`fit: beta=[${fullFit.beta.map((b) => b.toFixed(3)).join(', ')}] on ${comparables.length} comparables`);
console.log(`validation: LOO median miss x${loo.medianFactor.toFixed(2)} (baseline x${baselineFactor.toFixed(2)}), walk-forward x${walkForward.medianFactor.toFixed(2)}`);
console.log(`verdicts: FARM ${verdictCounts.FARM}, MARGINAL ${verdictCounts.MARGINAL}, SKIP ${verdictCounts.SKIP}`);
console.log(`top: ${top.join(' | ')}`);
console.log(`dossier: ${dossier.length} bytes`);
