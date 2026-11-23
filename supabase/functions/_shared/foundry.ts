import { store } from './store.ts';

/**
 * Foundry seed data shared by foundryApi (state/draft) and maintenanceChief,
 * so whichever runs first on an empty database starts the swarm.
 * Copied from server/routes/foundry.js SEED_BOTS, plus Fund Bot.
 */

const rows = (result: any): any[] => {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  return [];
};

export type Seed = {
  key: string;
  classLabel: string;
  name: string;
  charter: string;
  revenueModel: string;
  riskLevel: string;
  est: [number, number];
};

// What each seeded bot needs before it can touch real money (same table as foundryOps).
export const ACCOUNT_PLAN: Record<string, [string, string, string]> = {
  think: ['none', 'none', 'Nothing. Runs on the console alone.'],
  maker: ['none', 'none', 'Nothing. Builds from approved charters.'],
  nft: ['needed', 'OpenSea', 'An OpenSea API key, or your marketplace wallet signature.'],
  buy: ['needed', 'Kraken', 'Trade-only API key with a hard cap. Entries spend, so read-only is wasted.'],
  sell: ['needed', 'Kraken', 'Trade-only API key. Withdrawals stay off.'],
  scraper: ['none', 'public market data', 'Nothing. Reads public prices, no key needed.'],
  maintenance: ['none', 'none', 'Nothing. Watches the swarm itself.'],
  treasury: ['needed', 'Mercury', 'A treasury account with read plus transfer limits.'],
  fraud: ['needed', 'Stripe Radar', 'A payments account to score authorizations against.'],
  payroll: ['needed', 'Gusto', 'Payroll API access and a funding account.'],
  spend: ['needed', 'Plaid', 'A Plaid client id and secret, or a bank export to read.'],
  fund: ['none', 'none', 'Nothing. Reads public programs; you sign and file every application.'],
};

// Starting swarm, copied from server/routes/foundry.js SEED_BOTS (+ Fund Bot).
export const SEED_BOTS: Seed[] = [
  {
    key: 'think',
    classLabel: 'Ideas',
    name: 'Think Bot',
    charter:
      'Studies the swarm, drafts new bot concepts and revenue lines, and queues each one for your approval. Never ships anything on its own.',
    revenueModel: 'Indirect: finds the next earner',
    riskLevel: 'Low',
    est: [0, 0],
  },
  {
    key: 'maker',
    classLabel: 'Ideas',
    name: 'Bot Maker',
    charter:
      'Turns approved concepts into runnable bots: writes the charter, the guardrails, and the first few tasks, then hands them to the swarm.',
    revenueModel: 'Indirect: builds the earners',
    riskLevel: 'Low',
    est: [0, 0],
  },
  {
    key: 'nft',
    classLabel: 'Markets',
    name: 'NFT Bot',
    charter:
      'Watches collections you own, tracks floor and royalty flows, and proposes listings or bids with a full cost sheet before anything is signed.',
    revenueModel: 'Royalties and spread on resale',
    riskLevel: 'High',
    est: [120, 900],
  },
  {
    key: 'buy',
    classLabel: 'Markets',
    name: 'Buy Bot',
    charter:
      'Hunts entries where price sits under your own valuation, sizes the order to your limits, and asks before it spends anything.',
    revenueModel: 'Margin on entries below fair value',
    riskLevel: 'High',
    est: [80, 640],
  },
  {
    key: 'sell',
    classLabel: 'Markets',
    name: 'Sell Bot',
    charter:
      'Works the exit side: staged take-profits, listing ladders, and a plain reason for every price it proposes.',
    revenueModel: 'Realised gains and spread',
    riskLevel: 'High',
    est: [90, 720],
  },
  {
    key: 'scraper',
    classLabel: 'Data',
    name: 'Scraper Bot',
    charter:
      'Collects public prices, fees, and listing counts into one tidy table so every other bot prices against the same truth.',
    revenueModel: 'Indirect: sharper pricing everywhere',
    riskLevel: 'Low',
    est: [0, 0],
  },
  {
    key: 'maintenance',
    classLabel: 'Operations',
    name: 'Maintenance Bot',
    charter:
      'Watches the swarm itself: restarts stuck jobs, rotates keys, checks every bot still matches its charter, and files a short health note.',
    revenueModel: 'Indirect: keeps uptime at 99.9%',
    riskLevel: 'Low',
    est: [0, 0],
  },
  {
    key: 'treasury',
    classLabel: 'Operations',
    name: 'Treasury Bot',
    charter:
      'Sweeps idle balances into the highest-yielding pocket every hour and keeps the working buffer topped up.',
    revenueModel: 'Yield on idle cash',
    riskLevel: 'Low',
    est: [140, 520],
  },
  {
    key: 'fraud',
    classLabel: 'Security',
    name: 'Fraud Watch',
    charter:
      'Scores every authorization in under 80ms and freezes anything that drifts from your normal pattern, then explains why.',
    revenueModel: 'Indirect: losses avoided',
    riskLevel: 'Low',
    est: [0, 0],
  },
  {
    key: 'payroll',
    classLabel: 'Operations',
    name: 'Payroll Runner',
    charter: 'Queues payouts, checks funding, and files ledger entries before each window closes.',
    revenueModel: 'Indirect: penalties avoided',
    riskLevel: 'Low',
    est: [0, 0],
  },
  {
    key: 'spend',
    classLabel: 'Insights',
    name: 'Spend Analyst',
    charter:
      'Tags transactions, catches recurring charges, and writes a plain-English weekly summary of where the money went.',
    revenueModel: 'Indirect: waste cut',
    riskLevel: 'Low',
    est: [60, 240],
  },
  {
    // Not in the Express seed. The console's Fund Bot desk and foundryOps'
    // ACCOUNT_PLAN expect a 'fund' bot, so the hosted swarm starts with it.
    key: 'fund',
    classLabel: 'Funding',
    name: 'Fund Bot',
    charter:
      'Reads every honest funding route for a business at this stage, ranks them fast, cheap and non-dilutive first, and assembles the packet. You sign and file every application.',
    revenueModel: 'Indirect: non-dilutive capital found',
    riskLevel: 'Low',
    est: [0, 0],
  },
];


export const slugify = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

export const estimate = ([low, high]: [number, number]) => Math.round(low + Math.random() * (high - low));

export const now = () => new Date().toISOString();

export async function logEvent(kind: string, message: string, botSlug = '') {
  await store.FoundryEvent.create({ kind, message, bot_slug: botSlug, created_at: now() });
}

/**
 * Seed the starting swarm when foundry_bot is empty. Migration 0002 adds a
 * unique index on foundry_bot.slug, so two first loads racing each other
 * cannot double-seed: the loser's insert fails and it re-reads the table.
 */
export async function ensureSeeded(): Promise<any[]> {
  const existing = rows(await store.FoundryBot.list(undefined, 200));
  if (existing.length) return existing;

  let created = 0;
  for (const seed of SEED_BOTS) {
    const plan = ACCOUNT_PLAN[seed.key];
    try {
      await store.FoundryBot.create({
        name: seed.name,
        slug: seed.key,
        class_label: seed.classLabel,
        charter: seed.charter,
        revenue_model: seed.revenueModel,
        risk_level: seed.riskLevel,
        status: 'running',
        source: 'seed',
        est_monthly: estimate(seed.est),
        last_action: 'Charter written, first cycle complete.',
        account_status: plan?.[0] || 'needed',
        account_provider: plan?.[1] || '',
        account_needs: plan?.[2] || '',
        last_run: null,
        last_result: '',
        created_at: now(),
      });
      created += 1;
    } catch (problem) {
      // Another request seeded this slug first.
      console.warn('seed skipped', seed.key, String(problem));
    }
  }

  if (created) {
    await logEvent('boot', `Swarm started with ${SEED_BOTS.length} bots. Think Bot is drafting the first proposals.`);
  }
  return rows(await store.FoundryBot.list(undefined, 200));
}
