// Token Launch Radar — entry for make.fun's "Build the best token launch radar" bounty.
// Reads the sealed DefiLlama snapshot, ranks pre-token protocols by the implied value
// their token would have if launched, and writes the board, the dashboard data and the
// dossier. Deterministic: the same snapshot bytes always produce the same output bytes.
// Node 22 standard library only; no network; runs in under 120 seconds on 1 CPU.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

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

interface Peer { slug: string; name: string; mcap: number; tvl: number; ratio: number }

interface CategoryStats {
  n: number;
  median: number;
  p25: number;
  p75: number;
  peers: Peer[];
}

interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  confidence: 'High' | 'Medium' | 'Low';
  drivers: string[];
  comparables: string[];
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

// A protocol "records no token" when DefiLlama carries no symbol, no gecko id and no
// market cap for it. That is a record, never proof it has no token.
function recordsNoToken(p: Protocol): boolean {
  return p.symbol === null && p.gecko_id === null && p.mcap_usd === null;
}

function recordsToken(p: Protocol): boolean {
  return !recordsNoToken(p);
}

// The watchlist rule, from the kit's RULES.txt: not a wrapped, staked or bridged product
// of a protocol whose token already trades. Categories that are themselves such products,
// names ending in a version marker, names carrying wrapped/staked/staking, and names that
// begin with an exchange's name are left out.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function isWrappedOrStakedProduct(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (/ (V\d+|v\d+|\d+\.\d+(\.\d+)?)$/.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x + ' ') || p.name === x)) return true;
  return false;
}

function isEligible(p: Protocol): boolean {
  return recordsNoToken(p) && !isWrappedOrStakedProduct(p);
}

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

// ------------------------------------------------------------------ comparables

// Launched protocols (a token already trades) with a market cap and TVL give the
// comparables: their market-cap-to-TVL ratio, by category. Ratios are winsorized to
// the 5th/90th percentile of all launched ratios first, so one extreme protocol
// (a tiny TVL with a huge market cap, or the reverse) cannot carry a category.
const launched = snap.protocols.filter(
  (p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
);
const allRatios = launched.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
const ratioLo = percentile(allRatios, 0.05);
const ratioHi = percentile(allRatios, 0.9);
const globalMedian = median(allRatios.map((r) => clamp(r, ratioLo, ratioHi)));
const globalP25 = percentile(allRatios.map((r) => clamp(r, ratioLo, ratioHi)), 0.25);
const globalP75 = percentile(allRatios.map((r) => clamp(r, ratioLo, ratioHi)), 0.75);

function winsorized(ratio: number): number {
  return clamp(ratio, ratioLo, ratioHi);
}

const byCategory = new Map<string, Protocol[]>();
for (const p of launched) {
  const key = p.category ?? 'Uncategorized';
  if (!byCategory.has(key)) byCategory.set(key, []);
  byCategory.get(key)!.push(p);
}

function categoryStats(category: string | null): CategoryStats {
  const key = category ?? 'Uncategorized';
  const peers = (byCategory.get(key) ?? [])
    .map((p) => ({ slug: p.slug, name: p.name, mcap: p.mcap_usd!, tvl: p.tvl_usd, ratio: winsorized(p.mcap_usd! / p.tvl_usd) }))
    .sort((a, b) => b.tvl - a.tvl);
  const ratios = peers.map((x) => x.ratio).sort((a, b) => a - b);
  const n = ratios.length;
  // Shrinkage: a category with few launched peers leans on the global median, so a
  // single odd peer cannot set the whole category's ratio.
  const w = n / (n + 4);
  const catMedian = n > 0 ? median(ratios) : globalMedian;
  const catP25 = n > 0 ? percentile(ratios, 0.25) : globalP25;
  const catP75 = n > 0 ? percentile(ratios, 0.75) : globalP75;
  return {
    n,
    median: w * catMedian + (1 - w) * globalMedian,
    p25: w * catP25 + (1 - w) * globalP25,
    p75: w * catP75 + (1 - w) * globalP75,
    peers: peers.slice(0, 3),
  };
}

// ------------------------------------------------------------------ farm plans

// Gas is a rough per-transaction cost on that chain, labelled approximate in the
// dashboard. Amounts scale with the protocol's TVL tier: bigger protocols get a
// bigger suggested position, so the plan stays proportionate.
const GAS_BY_CHAIN: Record<string, string> = {
  Ethereum: '$2–8', Arbitrum: '$0.05–0.30', Optimism: '$0.05–0.30', Base: '$0.02–0.20',
  'zkSync Era': '$0.05–0.30', Polygon: '$0.01–0.10', Binance: '$0.05–0.30',
  Avalanche: '$0.10–0.50', Solana: '~$0.01', Sui: '~$0.01', Aptos: '~$0.01',
  Fantom: '$0.01–0.10', Gnosis: '$0.01–0.10', Linea: '$0.05–0.30', Scroll: '$0.05–0.30',
  Blast: '$0.05–0.30', Mode: '$0.02–0.20', Mantle: '$0.02–0.20', Sei: '~$0.01',
};

function gasFor(chain: string): string {
  return GAS_BY_CHAIN[chain] ?? '$0.10–1.00';
}

function amountFor(tvl: number): string {
  if (tvl >= 1e9) return '$1,000';
  if (tvl >= 250e6) return '$500';
  if (tvl >= 50e6) return '$250';
  return '$100';
}

// One plan per category: four concrete steps, each with what it costs and how long
// it takes. The last step always states the risk plainly. Placeholders: {name} the
// protocol, {chain} its main chain, {amt} the suggested position, {gas} the rough
// gas cost, {tvl} its TVL as a short string.
const FARM_TEMPLATES: Record<string, string[]> = {
  Dexs: [
    'Swap {amt} worth of tokens on {name} on {chain} (about {gas} in gas, 5 minutes). Use two different pairs so the activity looks like real trading, not one wash trade.',
    'Add {amt} as liquidity to the busiest pool on {name} on {chain} (about {gas} in gas, 10 minutes). Keep the position open for at least 2 weeks so it reads as a real liquidity provider.',
    'Repeat one swap a week for a month on {name} (about {gas} per swap). Airdrop snapshots usually reward repeated use over time, not a single day of activity.',
    'Risk: no token is guaranteed, and a pool can lose value if prices move (impermanent loss). Only use money you can afford to lose, and never chase a rumoured snapshot date.',
  ],
  Lending: [
    'Supply {amt} of a major asset (ETH, USDC or wBTC) to {name} on {chain} (about {gas} in gas, 10 minutes). Supplying is the core action most lending airdrops weight.',
    'Borrow a small amount against the supply on {name} (about {gas} in gas, 5 minutes), then repay it within a week. Borrowing and repaying shows full use of the protocol.',
    'Keep the supply open for at least a month and check the position weekly. Long-lived positions are what snapshots usually catch; a one-day deposit rarely counts.',
    'Risk: no token is guaranteed, borrow rates move, and a sharp price drop can liquidate a leveraged position. Keep the loan well below the liquidation line.',
  ],
  Yield: [
    'Deposit {amt} into the highest-TVL vault on {name} on {chain} (about {gas} in gas, 10 minutes). Pick the vault with the longest track record, not the highest advertised yield.',
    'Leave the deposit to compound for at least a month, claiming rewards only when the gas cost is smaller than the reward (about {gas} per claim).',
    'Try a second vault on {name} with a smaller amount after two weeks, so the wallet shows more than one interaction with the protocol.',
    'Risk: no token is guaranteed, vault yields fall when TVL rises, and smart-contract bugs can lose deposits. Only use money you can afford to lose.',
  ],
  'Yield Aggregator': [
    'Deposit {amt} into the top vault on {name} on {chain} (about {gas} in gas, 10 minutes). Aggregators route to many strategies, so one deposit touches several underlying protocols.',
    'Rebalance or move the deposit to a different vault on {name} after two weeks (about {gas} in gas). A second distinct action strengthens the activity record.',
    'Keep funds in for at least a month and check the position weekly. Snapshots usually reward deposits that stay, not money that comes and goes in a day.',
    'Risk: no token is guaranteed, and an aggregator adds a layer of smart-contract risk on top of each strategy it uses. Only use money you can afford to lose.',
  ],
  RWA: [
    'Buy or hold {amt} of a tokenized real-world asset on {name} on {chain} (about {gas} in gas, 10 minutes). Check first whether the asset needs identity verification in your country.',
    'Hold the position for at least a month and collect any yield it pays. RWA airdrops, where they happen, usually reward holders, not flippers.',
    'Use a second RWA product on {name} if one fits (about {gas} in gas), so the wallet shows broader use of the platform.',
    'Risk: no token is guaranteed, tokenized assets can carry issuer and legal risk, and some are hard to sell quickly. Only use money you can afford to lose.',
  ],
  Derivatives: [
    'Open a small perpetual or options position of {amt} notional on {name} on {chain} (about {gas} in gas, 10 minutes). Keep leverage low (2x or less) so a normal move cannot liquidate you.',
    'Close the position after a few days, then open one more the following week. Two separate trading weeks read as a real trader, not a one-off.',
    'Set a stop-loss on every position and never leave an open position unattended overnight. Derivatives move fast and losses compound.',
    'Risk: no token is guaranteed, and leveraged trading can lose the whole position quickly. Only trade money you can afford to lose, and never borrow to trade.',
  ],
  CDP: [
    'Lock {amt} of collateral and mint a stablecoin on {name} on {chain} (about {gas} in gas, 10 minutes). Keep the collateral ratio comfortably above the minimum.',
    'Use the minted stablecoin somewhere real (a swap or a deposit) rather than letting it sit, then repay part of the loan after two weeks (about {gas} per action).',
    'Keep the position open for at least a month, checking the collateral ratio weekly. A long-lived CDP is the behaviour snapshots usually reward.',
    'Risk: no token is guaranteed, and a price crash can liquidate collateral fast. Keep a large safety margin and never mint to the maximum.',
  ],
  'Risk Curators': [
    'Deposit {amt} into the largest curated vault on {name} on {chain} (about {gas} in gas, 10 minutes). Read which curator manages it and what its past vaults returned first.',
    'Leave the deposit for at least a month and compare its return with the vault’s stated strategy weekly. Curators are judged on steady returns, not one good week.',
    'Try a second curator’s vault on {name} with a smaller amount after two weeks, so the wallet shows use of more than one curator.',
    'Risk: no token is guaranteed, and a curator’s strategy can underperform or carry the same smart-contract risk as the vaults it manages. Only use money you can afford to lose.',
  ],
  'Onchain Capital Allocator': [
    'Allocate {amt} to the largest fund or vault on {name} on {chain} (about {gas} in gas, 10 minutes). Read the allocation strategy and its past performance before depositing.',
    'Hold the allocation for at least a month and review its reported returns weekly. Allocators reward patient capital; quick in-and-out rarely registers.',
    'Add a second, smaller allocation to a different strategy on {name} after two weeks, to show broader use of the platform.',
    'Risk: no token is guaranteed, and allocator returns depend on the strategies underneath. Only use money you can afford to lose.',
  ],
  'Basis Trading': [
    'Deposit {amt} into the basis strategy on {name} on {chain} (about {gas} in gas, 10 minutes). Basis returns come from funding rates, so check the recent rate history first.',
    'Hold the position for at least a month and watch the funding rate weekly. A position held through both positive and negative funding reads as real use.',
    'Withdraw and re-deposit once after two weeks (about {gas} per action) to show a second distinct interaction with the strategy.',
    'Risk: no token is guaranteed, funding rates can turn negative, and basis trades carry exchange and smart-contract risk. Only use money you can afford to lose.',
  ],
};

const GENERIC_FARM: string[] = [
  'Use {name}’s core feature with {amt} on {chain} (about {gas} in gas, 10 minutes). Do the action the protocol exists for, not a side feature.',
  'Repeat the action once a week for a month (about {gas} per action). Repeated real use is what airdrop snapshots usually reward.',
  'Try a second feature of {name} after two weeks, so the wallet shows more than one kind of interaction with the protocol.',
  'Risk: no token is guaranteed, and every onchain action carries smart-contract risk. Only use money you can afford to lose, and never pay anyone who promises a guaranteed airdrop.',
];

function farmSteps(p: Protocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const tpl = FARM_TEMPLATES[p.category ?? ''] ?? GENERIC_FARM;
  const sub = (s: string): string =>
    s
      .replaceAll('{name}', p.name)
      .replaceAll('{chain}', chain)
      .replaceAll('{amt}', amountFor(p.tvl_usd))
      .replaceAll('{gas}', gasFor(chain))
      .replaceAll('{tvl}', money(p.tvl_usd));
  const steps = tpl.map(sub);
  for (const s of steps) {
    const n = s.trim().length;
    if (n < 20 || n > 600) throw new Error(`farm step length ${n} for ${p.slug}: ${s.slice(0, 80)}`);
  }
  return steps;
}

// ------------------------------------------------------------------ valuation

// Implied value = TVL × peer ratio (launched protocols in the same category),
// adjusted by 7-day TVL growth and by how long the protocol has run with no token.
// Low/base/high use the category's 25th/50th/75th percentile peer ratio, shrunk the
// same way. Everything comes from the snapshot; nothing is hardcoded by name.
function valueRow(p: Protocol, stats: CategoryStats): Row {
  const growth = p.change_7d ?? 0;
  const growthFactor = 1 + clamp(growth, -30, 30) * 0.004;
  const age = ageDays(p);
  const ageYears = age === null ? null : age / 365;
  const ageFactor = ageYears === null ? 1 : 0.92 + 0.08 * (Math.min(ageYears, 4) / 4);
  const base = Math.max(1, Math.round(p.tvl_usd * stats.median * growthFactor * ageFactor));
  const low = Math.max(1, Math.round(p.tvl_usd * stats.p25 * growthFactor * ageFactor));
  const high = Math.max(1, Math.round(p.tvl_usd * stats.p75 * growthFactor * ageFactor));
  const lowUsd = Math.min(low, base);
  const highUsd = Math.max(high, base);

  let score = 0;
  if (stats.n >= 6) score += 2;
  else if (stats.n >= 3) score += 1;
  if (p.change_7d !== null) score += 1;
  if (p.listed_at !== null) score += 1;
  if (p.tvl_usd >= 100e6) score += 1;
  const confidence: Row['confidence'] = score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Low';

  const drivers: string[] = [
    `TVL ${money(p.tvl_usd)} × peer ratio ${stats.median.toFixed(3)} (${stats.n} launched ${p.category ?? 'Uncategorized'} peer${stats.n === 1 ? '' : 's'})`,
    p.change_7d === null
      ? '7-day TVL change not reported, so no growth adjustment'
      : `7-day TVL ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% → ×${growthFactor.toFixed(3)}`,
    age === null
      ? 'Listing date not reported, so no age adjustment'
      : `Running ${ageYears!.toFixed(1)} years with no token recorded → ×${ageFactor.toFixed(3)}`,
  ];

  return {
    slug: p.slug,
    name: p.name,
    rank: 0,
    implied_value_usd: base,
    low_usd: lowUsd,
    high_usd: highUsd,
    category: p.category ?? 'Uncategorized',
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: age,
    confidence,
    drivers,
    comparables: stats.peers.map((x) => `${x.name} (${money(x.mcap)} mcap / ${money(x.tvl)} TVL, ratio ${x.ratio.toFixed(2)})`),
    farm_steps: farmSteps(p),
  };
}

// ------------------------------------------------------------------ build rows

const eligible = snap.protocols.filter(isEligible).sort((a, b) => (a.slug < b.slug ? -1 : 1));
const statsByCategory = new Map<string, CategoryStats>();
for (const p of eligible) {
  const key = p.category ?? 'Uncategorized';
  if (!statsByCategory.has(key)) statsByCategory.set(key, categoryStats(p.category));
}

const rows: Row[] = eligible.map((p) => valueRow(p, statsByCategory.get(p.category ?? 'Uncategorized')!));
rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
rows.forEach((r, i) => {
  r.rank = i + 1;
});

// The watchlist is the floor, never the ceiling: every one of its 40 protocols must
// appear among the rows. Fail loudly here rather than shipping a board the gate refuses.
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
    method:
      'Implied value = TVL x median market-cap/TVL of launched protocols in the same category (ratios winsorized to the 5th/90th percentile, shrunk toward the global median), adjusted by 7-day TVL growth and by how long the protocol has run with no token recorded. Low/high use the category 25th/75th percentile ratio. A protocol "records no token" when DefiLlama carries no symbol, gecko id or market cap for it.',
  },
  rows,
};

// Dashboard data: compact, so the whole dashboard source stays under the 64 KB the
// dossier's text can show the judge. Farm steps and valuation drivers are rebuilt in
// the page from the same templates and figures, so the screenshots and board.json agree.
const categories: string[] = [...statsByCategory.keys()].sort();
const catIndex = new Map(categories.map((c, i) => [c, i]));
const allChains: string[] = [...new Set(rows.flatMap((r) => r.chains))].sort();
const chainIndex = new Map(allChains.map((c, i) => [c, i]));
const confIndex = new Map([['Low', 0], ['Medium', 1], ['High', 2]]);

const dashData = {
  meta: {
    asOf: snap.as_of,
    floor: FLOOR,
    rows: rows.length,
    watchlist: snap.watchlist.length,
    globalMedian: Number(globalMedian.toFixed(4)),
  },
  categories: categories.map((c) => {
    const s = statsByCategory.get(c)!;
    return [c, s.n, Number(s.median.toFixed(4)), Number(s.p25.toFixed(4)), Number(s.p75.toFixed(4)),
      s.peers.map((x) => [x.slug, x.name, x.mcap, x.tvl, Number(x.ratio.toFixed(3))])];
  }),
  chains: allChains,
  templates: FARM_TEMPLATES,
  generic: GENERIC_FARM,
  gas: GAS_BY_CHAIN,
  rows: rows.map((r) => [
    r.slug, r.name, catIndex.get(r.category)!, r.chains.map((c) => chainIndex.get(c)!),
    r.tvl_usd, r.change_7d, r.age_days, r.low_usd, r.implied_value_usd, r.high_usd,
    confIndex.get(r.confidence)!,
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

const top = rows.slice(0, 5).map((r) => `#${r.rank} ${r.slug} ${money(r.implied_value_usd)}`);
console.log(`board: ${rows.length} rows, watchlist ${snap.watchlist.length}/${snap.watchlist.length} covered`);
console.log(`top: ${top.join(' | ')}`);
console.log(`global peer ratio (median mcap/TVL): ${globalMedian.toFixed(3)} (winsorized ${ratioLo.toFixed(3)}–${ratioHi.toFixed(3)})`);
console.log(`dossier: ${dossier.length} bytes`);
