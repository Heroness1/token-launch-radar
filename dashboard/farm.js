// Farm plans. Shared by main.ts (board.json) and the dashboard, so the two
// can never drift apart. Each step carries its gas cost and hands-on minutes.
export const PARAMS = {
  depositUsd: 10000, // one fixed position, so every verdict is comparable
  dropShare: 0.05, // share of launch value the airdrop pays farmers
  horizonWeeks: 12, // how long the farm runs before the verdict is judged
  hourlyRateUsd: 25, // what an hour of the farmer's time is worth
  tbillAnnual: 0.04, // risk-free benchmark over the horizon
  exploitAnnual: 0.05, // exploit reserve: 5% of deposit a year
  exitDropPct: 20, // withdraw if TVL falls this far below plan time
};

// Rough cost of one onchain transaction on each chain, in USD.
export const GAS_USD = {
  Ethereum: 5.0, Arbitrum: 0.18, Optimism: 0.18, Base: 0.11, 'zkSync Era': 0.18,
  Polygon: 0.05, Binance: 0.18, Avalanche: 0.3, Solana: 0.01, Sui: 0.01, Aptos: 0.01,
  Fantom: 0.05, Gnosis: 0.05, Linea: 0.18, Scroll: 0.18, Blast: 0.18, Mode: 0.11,
  Mantle: 0.11, Sei: 0.01,
};

// Gas token per chain; most EVM chains pay gas in ETH.
const GAS_TOKEN_EXC = { Polygon: 'POL', Binance: 'BNB', Avalanche: 'AVAX', Solana: 'SOL', Sui: 'SUI', Aptos: 'APT', Fantom: 'FTM', Gnosis: 'xDAI', Mantle: 'MNT', Sei: 'SEI' };
function gasTokenFor(chain) { return GAS_TOKEN_EXC[chain] ?? 'ETH'; }

// Wallet per chain; most EVM chains use the same wallet.
const WALLET_EXC = { Solana: 'a Solana wallet (Phantom or Solflare)', Sui: 'a Sui wallet (Sui Wallet or Surf)', Aptos: 'an Aptos wallet (Petra or Pontem)', Sei: 'a Sei wallet (Compass or Fin)' };
function walletFor(chain) { return WALLET_EXC[chain] ?? 'an EVM wallet (MetaMask or Rabby)'; }

function gasFor(chain) {
  return GAS_USD[chain] ?? 0.5;
}

export function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 2).replace(/\.00$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

// A step is {t: text, g: onchain transactions, m: hands-on minutes}.
function S(t, g, m) {
  return { t, g, m };
}

// --- setup (3) and closing (3). Core (3) is per category. ---

function setupSteps(p, chain) {
  const wallet = walletFor(chain);
  const gasToken = gasTokenFor(chain);
  return [
    S(`Set up ${wallet} with a fresh address just for this farm. Keep the recovery phrase offline, on paper — never in a screenshot or chat.`, 0, 10),
    S(`Buy about $5 of ${gasToken} on ${chain} for gas before any deposit. Without gas, no transaction can run.`, 1, 5),
    S(`Find ${p.name}’s official app through its DefiLlama page and confirm the contract address matches the docs. Never open a link from a chat or DM.`, 0, 5),
  ];
}

function closingSteps(p) {
  const exitTvl = money(p.tvl_usd * (1 - PARAMS.exitDropPct / 100));
  return [
    S(`Check the position every week for ${PARAMS.horizonWeeks} weeks. Claim or compound only when gas costs less than the reward.`, 1, 5),
    S(`Record every action: date, transaction hash, asset, amount and dollar value. A claim or tax return will ask for it.`, 0, 5),
    S(`Leave if ${p.name}’s TVL drops under ${exitTvl} (${PARAMS.exitDropPct}% below today’s ${money(p.tvl_usd)}), or if withdrawals stop working. No token is guaranteed — only use money you can afford to lose.`, 1, 10),
  ];
}

// --- core actions: 3 concrete steps per category. ---

const CORE = {
  Dexs: [
    S(`Swap ${'{amt}'} on ${'{name}'} (${'{chain}'}), across two different pairs, so the activity reads as real trading.`, 2, 10),
    S(`Add ${'{amt}'} as liquidity to the busiest pool on ${'{name}'} and keep it open for at least 2 weeks.`, 1, 10),
    S(`Swap a smaller amount once a week for a month on ${'{name}'}. Snapshots reward repeated use over time.`, 4, 5),
  ],
  Lending: [
    S(`Supply ${'{amt}'} of a major asset (ETH, USDC or wBTC) to ${'{name}'} (${'{chain}'}). Supplying is the core action most lending airdrops weight.`, 1, 10),
    S(`Borrow a small amount against the supply on ${'{name}'}, then repay it within a week. Borrowing and repaying shows full use.`, 2, 5),
    S(`Keep the supply open for at least a month, checking weekly. Long-lived positions are what snapshots catch.`, 0, 5),
  ],
  Yield: [
    S(`Deposit ${'{amt}'} into the highest-TVL vault on ${'{name}'} (${'{chain}'}). Pick the vault with the longest track record.`, 1, 10),
    S(`Leave the deposit to compound for at least a month, claiming rewards only when gas costs less than the reward.`, 1, 5),
    S(`Try a second vault on ${'{name}'} with a smaller amount after two weeks, so the wallet shows more than one interaction.`, 1, 10),
  ],
  'Yield Aggregator': [
    S(`Deposit ${'{amt}'} into the top vault on ${'{name}'} (${'{chain}'}). One deposit touches several underlying protocols.`, 1, 10),
    S(`Move the deposit to a different vault on ${'{name}'} after two weeks. A second distinct action strengthens the record.`, 1, 10),
    S(`Keep funds in for at least a month, checking weekly. Snapshots reward deposits that stay, not money that comes and goes.`, 0, 5),
  ],
  RWA: [
    S(`Buy or hold ${'{amt}'} of a tokenized real-world asset on ${'{name}'} (${'{chain}'}). Check first whether it needs identity verification in your country.`, 1, 10),
    S(`Hold the position for at least a month and collect any yield it pays. RWA rewards usually go to holders, not flippers.`, 1, 5),
    S(`Check the issuer and redemption terms before adding more. A tokenized asset can be hard to sell quickly.`, 0, 5),
  ],
  Derivatives: [
    S(`Open a small perpetual or options position of ${'{amt}'} notional on ${'{name}'} (${'{chain}'}). Keep leverage at 2x or less.`, 1, 10),
    S(`Set a stop-loss before anything else, and never leave an open position unattended overnight.`, 1, 5),
    S(`Close the position after a few days, then open one more the following week. Two trading weeks read as a real trader.`, 2, 5),
  ],
  CDP: [
    S(`Lock ${'{amt}'} of collateral and mint a stablecoin on ${'{name}'} (${'{chain}'}). Keep the collateral ratio well above the minimum.`, 1, 10),
    S(`Use the minted stablecoin somewhere real (a swap or deposit), then repay part of the loan after two weeks.`, 2, 5),
    S(`Keep the position open for at least a month, checking the collateral ratio weekly. A price crash can liquidate fast.`, 0, 5),
  ],
  'Risk Curators': [
    S(`Deposit ${'{amt}'} into the largest curated vault on ${'{name}'} (${'{chain}'}). Read which curator manages it first.`, 1, 10),
    S(`Leave the deposit for at least a month and compare its return with the vault’s stated strategy weekly.`, 0, 5),
    S(`Try a second curator’s vault on ${'{name}'} with a smaller amount after two weeks, to show use of more than one curator.`, 1, 10),
  ],
  'Onchain Capital Allocator': [
    S(`Allocate ${'{amt}'} to the largest fund or vault on ${'{name}'} (${'{chain}'}). Read the strategy and past performance first.`, 1, 10),
    S(`Hold the allocation for at least a month, reviewing reported returns weekly. Allocators reward patient capital.`, 0, 5),
    S(`Add a second, smaller allocation to a different strategy on ${'{name}'} after two weeks, to show broader use.`, 1, 10),
  ],
  'Basis Trading': [
    S(`Deposit ${'{amt}'} into the basis strategy on ${'{name}'} (${'{chain}'}). Check the recent funding-rate history first.`, 1, 10),
    S(`Hold for at least a month and watch the funding rate weekly. A position held through both positive and negative funding reads as real use.`, 0, 5),
    S(`Check what happens when funding turns negative for a stretch. If the docs do not say, keep the size small.`, 0, 5),
  ],
};

const GENERIC_CORE = [
  S(`Use ${'{name}'}’s core feature with ${'{amt}'} on ${'{chain}'}. Do the action the protocol exists for.`, 1, 10),
  S(`Repeat the action once a week for a month. Repeated real use is what snapshots usually reward.`, 4, 5),
  S(`Try a second feature of ${'{name}'} after two weeks, so the wallet shows more than one kind of interaction.`, 1, 10),
];

// --- the plan: 9 steps, each rendered with its cost and time. ---
// `depositUsd` overrides the amount named in the steps, so the dashboard's
// deposit control rewrites the plan to match. board.json uses the default.

export function farmSteps(p, depositUsd = PARAMS.depositUsd) {
  const chain = p.chains[0] ?? 'Ethereum';
  const amt = '$' + depositUsd.toLocaleString('en-US');
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

// --- the economics: expected payoff of farming this protocol. ---
// `over` lets the dashboard's controls change the deposit, drop share and
// T-bill rate live; board.json uses the defaults, so the default view agrees
// with the board. The exploit reserve is a cost like gas and time.

export function farmEconomics(p, valueIfLaunches, tokenOdds, over = {}) {
  const chain = p.chains[0] ?? 'Ethereum';
  const steps = farmSteps(p);
  const gasTotal = steps.reduce((a, s) => a + s.gasUsd, 0);
  const minutes = steps.reduce((a, s) => a + s.minutes, 0);
  const hours = minutes / 60;
  const timeCost = hours * PARAMS.hourlyRateUsd;
  const deposit = over.depositUsd ?? PARAMS.depositUsd;
  const dropShare = over.dropShare ?? PARAMS.dropShare;
  const tbillAnnual = over.tbillAnnual ?? PARAMS.tbillAnnual;
  const horizonYears = PARAMS.horizonWeeks / 52;
  // A farmer's share of the drop is deposit / TVL. Expected drop =
  // odds x drop share x launch value x share.
  const share = deposit / (p.tvl_usd + deposit);
  const expectedDrop = tokenOdds * dropShare * valueIfLaunches * share;
  const exploitReserve = deposit * PARAMS.exploitAnnual * horizonYears;
  const benchmark = deposit * tbillAnnual * horizonYears;
  const net = expectedDrop - gasTotal - timeCost - exploitReserve;
  const verdict = net > benchmark ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  // Break-even odds: the lowest odds at which the farm covers every cost and
  // the benchmark. If the drop at 100% odds cannot cover them, it never pays.
  const dropAtFullOdds = dropShare * valueIfLaunches * share;
  const costToBeat = gasTotal + timeCost + exploitReserve + benchmark;
  const breakEvenOdds = dropAtFullOdds > 0 ? costToBeat / dropAtFullOdds : Infinity;
  // Minimum ticket: the smallest deposit at which the net turns positive,
  // by bisection. Some protocols never pay at any size — then it is null.
  const minTicket = minDepositFor(p, valueIfLaunches, tokenOdds, over);
  return {
    expectedDrop, gasTotal, minutes, hours, timeCost, exploitReserve, net, benchmark, verdict,
    perHour: hours > 0 ? net / hours : 0,
    breakEvenOdds: breakEvenOdds <= 1 ? breakEvenOdds : null,
    minTicket,
  };
}

// Net payoff at a given deposit. Used by the minimum-ticket search and
// the sensitivity table.
function netAtDeposit(p, valueIfLaunches, tokenOdds, deposit, over = {}) {
  const chain = p.chains[0] ?? 'Ethereum';
  const steps = farmSteps(p);
  const gasTotal = steps.reduce((a, s) => a + s.gasUsd, 0);
  const minutes = steps.reduce((a, s) => a + s.minutes, 0);
  const timeCost = (minutes / 60) * PARAMS.hourlyRateUsd;
  const dropShare = over.dropShare ?? PARAMS.dropShare;
  const horizonYears = PARAMS.horizonWeeks / 52;
  const share = deposit / (p.tvl_usd + deposit);
  const expectedDrop = tokenOdds * dropShare * valueIfLaunches * share;
  const exploitReserve = deposit * PARAMS.exploitAnnual * horizonYears;
  return expectedDrop - gasTotal - timeCost - exploitReserve;
}

function minDepositFor(p, valueIfLaunches, tokenOdds, over = {}) {
  if (netAtDeposit(p, valueIfLaunches, tokenOdds, p.tvl_usd, over) <= 0) return null;
  let lo = 1;
  let hi = p.tvl_usd;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (netAtDeposit(p, valueIfLaunches, tokenOdds, mid, over) > 0) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

// Sensitivity: verdict and net for a grid of drop shares and ticket sizes.
export function farmSensitivity(p, valueIfLaunches, tokenOdds) {
  const dropShares = [0.025, 0.05, 0.1];
  const tickets = [1000, 10000, 25000];
  return {
    dropShares,
    tickets,
    cells: dropShares.map((ds) =>
      tickets.map((tk) => {
        const e = farmEconomics(p, valueIfLaunches, tokenOdds, { depositUsd: tk, dropShare: ds });
        return { verdict: e.verdict, net: Math.round(e.net) };
      }),
    ),
  };
}
