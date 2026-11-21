// Farm plans for the Token Launch Radar. Shared by main.ts (which writes board.json)
// and the dashboard (which renders the same steps), so the two can never drift apart.
// Every step carries its own gas cost (in onchain transactions) and hands-on minutes;
// board.json's strings and the dashboard's totals both come from these numbers.
// Money and time figures here are the entry's own assumptions, labelled as such on
// the dashboard. Only the protocol's TVL, category, chains and age come from the snapshot.
export const PARAMS = {
  depositUsd: 10000, // one fixed position, so every verdict is comparable
  dropShare: 0.05, // share of the token's launch value the airdrop is assumed to pay farmers
  horizonWeeks: 12, // how long the farm runs before the verdict is judged
  hourlyRateUsd: 25, // what an hour of the farmer's time is valued at
  tbillAnnual: 0.04, // risk-free benchmark: a 4% annual T-bill over the horizon
  exitDropPct: 20, // withdraw if TVL falls this far below the level at plan time
};

// Rough cost of one onchain transaction on each chain, in USD. Labelled approximate
// on the dashboard; the plan's gas total is the step count times this figure.
export const GAS_USD = {
  Ethereum: 5.0, Arbitrum: 0.18, Optimism: 0.18, Base: 0.11, 'zkSync Era': 0.18,
  Polygon: 0.05, Binance: 0.18, Avalanche: 0.3, Solana: 0.01, Sui: 0.01, Aptos: 0.01,
  Fantom: 0.05, Gnosis: 0.05, Linea: 0.18, Scroll: 0.18, Blast: 0.18, Mode: 0.11,
  Mantle: 0.11, Sei: 0.01,
};

export const GAS_TOKEN = {
  Ethereum: 'ETH', Arbitrum: 'ETH', Optimism: 'ETH', Base: 'ETH', 'zkSync Era': 'ETH',
  Polygon: 'POL', Binance: 'BNB', Avalanche: 'AVAX', Solana: 'SOL', Sui: 'SUI', Aptos: 'APT',
  Fantom: 'FTM', Gnosis: 'xDAI', Linea: 'ETH', Scroll: 'ETH', Blast: 'ETH', Mode: 'ETH',
  Mantle: 'MNT', Sei: 'SEI',
};

export const WALLET = {
  Ethereum: 'an EVM wallet (MetaMask or Rabby)',
  Arbitrum: 'an EVM wallet (MetaMask or Rabby)',
  Optimism: 'an EVM wallet (MetaMask or Rabby)',
  Base: 'an EVM wallet (MetaMask or Rabby)',
  'zkSync Era': 'an EVM wallet (MetaMask or Rabby)',
  Polygon: 'an EVM wallet (MetaMask or Rabby)',
  Binance: 'an EVM wallet (MetaMask or Rabby)',
  Avalanche: 'an EVM wallet (MetaMask or Rabby)',
  Fantom: 'an EVM wallet (MetaMask or Rabby)',
  Gnosis: 'an EVM wallet (MetaMask or Rabby)',
  Linea: 'an EVM wallet (MetaMask or Rabby)',
  Scroll: 'an EVM wallet (MetaMask or Rabby)',
  Blast: 'an EVM wallet (MetaMask or Rabby)',
  Mode: 'an EVM wallet (MetaMask or Rabby)',
  Mantle: 'an EVM wallet (MetaMask or Rabby)',
  Solana: 'a Solana wallet (Phantom or Solflare)',
  Sui: 'a Sui wallet (Sui Wallet or Surf)',
  Aptos: 'an Aptos wallet (Petra or Pontem)',
  Sei: 'a Sei wallet (Compass or Fin)',
};

function gasFor(chain) {
  return GAS_USD[chain] ?? 0.5;
}

function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 2).replace(/\.00$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

// A step is {t: text with {name} {chain} {amt} {tvl} {exit} placeholders,
// g: onchain transactions it needs, m: hands-on minutes}. The rendered string
// appends its cost and time, so the reader sees both in the same line.
function S(t, g, m) {
  return { t, g, m };
}

// --- shared scaffolding: setup (3) and closing (3). Core (4) is per category. ---

function setupSteps(p, chain) {
  const wallet = WALLET[chain] ?? 'a wallet for ' + chain;
  const gasToken = GAS_TOKEN[chain] ?? 'the chain’s gas token';
  return [
    S(`Set up ${wallet} and keep its recovery phrase offline, on paper, never in a screenshot or a chat. Use a fresh address just for this farm, so the activity is easy to tell apart.`, 0, 10),
    S(`Buy about $5 of ${gasToken} on ${chain} for gas before any deposit. Without gas no transaction can run, and a stuck first deposit is the most common beginner mistake.`, 1, 5),
    S(`Find ${p.name}’s official app through its DefiLlama page, and confirm the contract address there matches the one in the docs. If a link reaches you in a chat or DM, do not open it — go to the official site yourself instead.`, 0, 5),
  ];
}

function closingSteps(p) {
  const exitTvl = money(p.tvl_usd * (1 - PARAMS.exitDropPct / 100));
  return [
    S(`Check the position every week for ${PARAMS.horizonWeeks} weeks: claim or compound only when the gas costs less than the reward, and check the TVL has not fallen sharply.`, 1, 5),
    S(`Record every action from the start: the date, the transaction hash, the asset and amount, and its dollar value. That record is what a claim or a tax return will ask for.`, 0, 5),
    S(`Leave if ${p.name}’s TVL drops under ${exitTvl} (${PARAMS.exitDropPct}% below today’s ${money(p.tvl_usd)}), or if withdrawals stop working. No token is guaranteed and a drop can be worth nothing — only use money you can afford to lose.`, 1, 10),
  ];
}

// --- core actions: 4 concrete steps per category. ---

const CORE = {
  Dexs: [
    S(`Swap ${'{amt}'} of tokens on ${'{name}'} on ${'{chain}'}, across two different pairs, so the activity reads as real trading rather than one wash trade.`, 2, 10),
    S(`Add ${'{amt}'} as liquidity to the busiest pool on ${'{name}'}, and keep the position open for at least 2 weeks so it reads as a real liquidity provider.`, 1, 10),
    S(`Swap a smaller amount once a week for a month on ${'{name}'}. Airdrop snapshots usually reward repeated use over time, not a single day of activity.`, 4, 5),
    S(`Remove half the liquidity after a month and re-add it to a different pool on ${'{name}'}, so the wallet shows a second distinct interaction with the protocol.`, 2, 10),
  ],
  Lending: [
    S(`Supply ${'{amt}'} of a major asset (ETH, USDC or wBTC) to ${'{name}'} on ${'{chain}'}. Supplying is the core action most lending airdrops weight.`, 1, 10),
    S(`Borrow a small amount against the supply on ${'{name}'}, then repay it within a week. Borrowing and repaying shows full use of the protocol.`, 2, 5),
    S(`Keep the supply open for at least a month and check the position weekly. Long-lived positions are what snapshots usually catch; a one-day deposit rarely counts.`, 0, 5),
    S(`Supply a second, smaller asset to ${'{name}'} after two weeks, so the wallet shows more than one market used.`, 1, 10),
  ],
  Yield: [
    S(`Deposit ${'{amt}'} into the highest-TVL vault on ${'{name}'} on ${'{chain}'}. Pick the vault with the longest track record, not the highest advertised yield.`, 1, 10),
    S(`Leave the deposit to compound for at least a month, claiming rewards only when the gas costs less than the reward.`, 1, 5),
    S(`Try a second vault on ${'{name}'} with a smaller amount after two weeks, so the wallet shows more than one interaction with the protocol.`, 1, 10),
    S(`Compare the vault’s realised return with its stated strategy weekly. A vault that quietly changes strategy is a reason to leave, not to add more.`, 0, 5),
  ],
  'Yield Aggregator': [
    S(`Deposit ${'{amt}'} into the top vault on ${'{name}'} on ${'{chain}'}. Aggregators route to many strategies, so one deposit touches several underlying protocols.`, 1, 10),
    S(`Rebalance or move the deposit to a different vault on ${'{name}'} after two weeks. A second distinct action strengthens the activity record.`, 1, 10),
    S(`Keep funds in for at least a month and check the position weekly. Snapshots usually reward deposits that stay, not money that comes and goes in a day.`, 0, 5),
    S(`Read what the aggregator’s current allocation is before adding more. If it has moved into a strategy you do not understand, do not follow it blindly.`, 0, 5),
  ],
  RWA: [
    S(`Buy or hold ${'{amt}'} of a tokenized real-world asset on ${'{name}'} on ${'{chain}'}. Check first whether the asset needs identity verification in your country.`, 1, 10),
    S(`Hold the position for at least a month and collect any yield it pays. RWA rewards, where they happen, usually go to holders, not flippers.`, 1, 5),
    S(`Use a second RWA product on ${'{name}'} if one fits, so the wallet shows broader use of the platform.`, 1, 10),
    S(`Check the issuer and the redemption terms before adding more. A tokenized asset can be hard to sell quickly, and its issuer carries the real-world risk.`, 0, 5),
  ],
  Derivatives: [
    S(`Open a small perpetual or options position of ${'{amt}'} notional on ${'{name}'} on ${'{chain}'}. Keep leverage at 2x or less so a normal move cannot liquidate you.`, 1, 10),
    S(`Set a stop-loss on the position before doing anything else, and never leave an open position unattended overnight.`, 1, 5),
    S(`Close the position after a few days, then open one more the following week. Two separate trading weeks read as a real trader, not a one-off.`, 2, 5),
    S(`Trade a second market on ${'{name}'} with a smaller size after two weeks, so the wallet shows more than one market used.`, 1, 10),
  ],
  CDP: [
    S(`Lock ${'{amt}'} of collateral and mint a stablecoin on ${'{name}'} on ${'{chain}'}. Keep the collateral ratio comfortably above the minimum.`, 1, 10),
    S(`Use the minted stablecoin somewhere real (a swap or a deposit) rather than letting it sit, then repay part of the loan after two weeks.`, 2, 5),
    S(`Keep the position open for at least a month, checking the collateral ratio weekly. A long-lived CDP is the behaviour snapshots usually reward.`, 0, 5),
    S(`Add a little more collateral if the ratio drifts toward the minimum. A price crash can liquidate collateral fast, so keep a large safety margin.`, 1, 10),
  ],
  'Risk Curators': [
    S(`Deposit ${'{amt}'} into the largest curated vault on ${'{name}'} on ${'{chain}'}. Read which curator manages it and what its past vaults returned first.`, 1, 10),
    S(`Leave the deposit for at least a month and compare its return with the vault’s stated strategy weekly. Curators are judged on steady returns, not one good week.`, 0, 5),
    S(`Try a second curator’s vault on ${'{name}'} with a smaller amount after two weeks, so the wallet shows use of more than one curator.`, 1, 10),
    S(`Check whether the curator has ever had a vault lose money, and how it reported it. A curator that hides losses is a reason to leave.`, 0, 5),
  ],
  'Onchain Capital Allocator': [
    S(`Allocate ${'{amt}'} to the largest fund or vault on ${'{name}'} on ${'{chain}'}. Read the allocation strategy and its past performance before depositing.`, 1, 10),
    S(`Hold the allocation for at least a month and review its reported returns weekly. Allocators reward patient capital; quick in-and-out rarely registers.`, 0, 5),
    S(`Add a second, smaller allocation to a different strategy on ${'{name}'} after two weeks, to show broader use of the platform.`, 1, 10),
    S(`Ask what the allocator charges and what it has returned net of fees. A strategy that looks good gross can be ordinary once fees are taken out.`, 0, 5),
  ],
  'Basis Trading': [
    S(`Deposit ${'{amt}'} into the basis strategy on ${'{name}'} on ${'{chain}'}. Basis returns come from funding rates, so check the recent rate history first.`, 1, 10),
    S(`Hold the position for at least a month and watch the funding rate weekly. A position held through both positive and negative funding reads as real use.`, 0, 5),
    S(`Withdraw and re-deposit once after two weeks to show a second distinct interaction with the strategy.`, 2, 10),
    S(`Check what happens to the strategy when funding turns negative for a stretch. If the answer is not in the docs, treat that as a reason to keep the size small.`, 0, 5),
  ],
};

const GENERIC_CORE = [
  S(`Use ${'{name}'}’s core feature with ${'{amt}'} on ${'{chain}'}. Do the action the protocol exists for, not a side feature.`, 1, 10),
  S(`Repeat the action once a week for a month. Repeated real use is what airdrop snapshots usually reward.`, 4, 5),
  S(`Try a second feature of ${'{name}'} after two weeks, so the wallet shows more than one kind of interaction with the protocol.`, 1, 10),
  S(`Check the protocol’s docs for anything it says it rewards (points, seasons, quests) and do only the parts that are real onchain actions, never paid shortcuts.`, 0, 5),
];

// --- the plan: 10 steps, each rendered with its cost and time. ---

export function farmSteps(p) {
  const chain = p.chains[0] ?? 'Ethereum';
  const amt = '$' + PARAMS.depositUsd.toLocaleString('en-US');
  const core = CORE[p.category ?? ''] ?? GENERIC_CORE;
  const steps = [...setupSteps(p, chain), ...core, ...closingSteps(p)];
  const perTx = gasFor(chain);
  return steps.map((s) => {
    const text = s.t
      .replaceAll('{name}', p.name)
      .replaceAll('{chain}', chain)
      .replaceAll('{amt}', amt)
      .replaceAll('{tvl}', money(p.tvl_usd));
    const gasUsd = s.g * perTx;
    const cost = gasUsd > 0 ? `about $${gasUsd.toFixed(2)} in gas` : 'free';
    const rendered = `${text} (Cost ${cost}; about ${s.m} minutes.)`;
    const n = rendered.trim().length;
    if (n < 20 || n > 600) throw new Error(`farm step length ${n} for ${p.slug}`);
    return { text: rendered, gasUsd, minutes: s.m, txs: s.g };
  });
}

// --- the economics: expected payoff of farming this protocol on the stated terms. ---

export function farmEconomics(p, valueIfLaunches, tokenOdds) {
  const chain = p.chains[0] ?? 'Ethereum';
  const steps = farmSteps(p);
  const gasTotal = steps.reduce((a, s) => a + s.gasUsd, 0);
  const minutes = steps.reduce((a, s) => a + s.minutes, 0);
  const hours = minutes / 60;
  const timeCost = hours * PARAMS.hourlyRateUsd;
  const deposit = PARAMS.depositUsd;
  // A farmer's share of the drop is taken as deposit / TVL, a rough proxy for their
  // share of protocol activity. Expected drop = odds x drop share x launch value x share.
  const expectedDrop = tokenOdds * PARAMS.dropShare * valueIfLaunches * (deposit / (p.tvl_usd + deposit));
  const net = expectedDrop - gasTotal - timeCost;
  const benchmark = deposit * PARAMS.tbillAnnual * (PARAMS.horizonWeeks / 52);
  const verdict = net > benchmark ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return {
    expectedDrop, gasTotal, minutes, hours, timeCost, net, benchmark, verdict,
    perHour: hours > 0 ? net / hours : 0,
  };
}
