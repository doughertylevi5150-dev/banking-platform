import { CORS_ALLOW_HEADERS, consoleToken, store } from '../_shared/store.ts';
import { ensureSeeded, estimate, logEvent, now, slugify, type Seed } from '../_shared/foundry.ts';

/**
 * The bot foundry: Think Bot drafts concepts, the owner approves or passes,
 * and only approved bots join the swarm.
 *
 * Ported from server/routes/foundry.js (the local Express copy, which mirrored
 * the Base44 functions/foundryApi.ts that never made it into the repo).
 *
 * Actions: state · draft · decide · toggle · retire · generate
 * Everything except `generate` needs the owner's console session, checked the
 * same way foundryOps checks it (banking_session token hash -> banking_owner).
 * `generate` stays public like the Express route so a scheduler can keep the
 * queue warm; it is bounded by PENDING_CAP and only ever adds pending drafts.
 */

const LOCKED = 'This console is limited to its owner.';
const PENDING_CAP = 6;

const headers = (req: Request) => ({
  'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
  'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '600',
  'Content-Type': 'application/json',
});

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(req) });

const rows = (result: any): any[] => {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  return [];
};

const num = (value: any) => (Number.isFinite(Number(value)) ? Number(value) : 0);

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Concepts Think Bot drafts, copied from server/routes/foundry.js ARCHETYPES.
const ARCHETYPES: Seed[] = [
  {
    key: 'yield-router',
    classLabel: 'Yield',
    name: 'Yield Router',
    charter:
      'Compares live rates across every pocket you hold, proposes moves only when the gain beats the fee, and shows the break-even day.',
    revenueModel: 'Interest spread',
    riskLevel: 'Low',
    est: [90, 480],
  },
  {
    key: 'fee-auditor',
    classLabel: 'Insights',
    name: 'Fee Auditor',
    charter:
      'Reads every statement line, flags fees that look accidental or negotiable, and drafts the refund request for you to send.',
    revenueModel: 'Recovered fees, shared with you',
    riskLevel: 'Low',
    est: [40, 260],
  },
  {
    key: 'invoice-chaser',
    classLabel: 'Cash',
    name: 'Invoice Chaser',
    charter:
      'Tracks what is owed to you, sends polite reminders on your schedule, and escalates before the payment window closes.',
    revenueModel: 'Faster collection, less aging',
    riskLevel: 'Low',
    est: [120, 700],
  },
  {
    key: 'reward-harvester',
    classLabel: 'Cash',
    name: 'Reward Harvester',
    charter:
      'Maps your real spend onto the cards and programs that pay best, then proposes switches with the annual gain spelled out.',
    revenueModel: 'Cashback and points value',
    riskLevel: 'Low',
    est: [70, 420],
  },
  {
    key: 'listing-ladder',
    classLabel: 'Markets',
    name: 'Listing Ladder',
    charter:
      'Splits inventory into staged listings, reprices on watcher counts, and pulls anything that stops drawing interest.',
    revenueModel: 'Spread on sold inventory',
    riskLevel: 'Medium',
    est: [110, 780],
  },
  {
    key: 'arbitrage-scout',
    classLabel: 'Markets',
    name: 'Arbitrage Scout',
    charter:
      'Compares the same asset across venues after fees and slippage, and only proposes a trade when the gap survives both.',
    revenueModel: 'Cross-venue spread',
    riskLevel: 'High',
    est: [100, 950],
  },
  {
    key: 'portfolio-rebalancer',
    classLabel: 'Markets',
    name: 'Rebalance Bot',
    charter:
      'Keeps your mix inside the bands you set, proposes the smallest trades that restore it, and warns when drift is harmless.',
    revenueModel: 'Risk-adjusted return',
    riskLevel: 'Medium',
    est: [80, 520],
  },
  {
    key: 'data-broker',
    classLabel: 'Data',
    name: 'Dataset Packager',
    charter:
      'Turns the swarm’s collected public data into clean, documented packs you could license, with provenance attached.',
    revenueModel: 'Data licensing',
    riskLevel: 'Medium',
    est: [140, 900],
  },
  {
    key: 'price-alerts',
    classLabel: 'Data',
    name: 'Signal Sender',
    charter:
      'Watches the few numbers you actually care about and sends one short message when a threshold breaks, never a stream.',
    revenueModel: 'Indirect: better timing',
    riskLevel: 'Low',
    est: [0, 0],
  },
  {
    key: 'tax-sorter',
    classLabel: 'Operations',
    name: 'Tax Sorter',
    charter:
      'Files every movement into the right bucket as it happens, so year-end is a download instead of a scramble.',
    revenueModel: 'Indirect: preparer hours saved',
    riskLevel: 'Low',
    est: [50, 300],
  },
  {
    key: 'debt-snowball',
    classLabel: 'Cash',
    name: 'Debt Sweeper',
    charter:
      'Orders your balances by real cost of carry, proposes the payoff path, and shows the interest you avoid each month.',
    revenueModel: 'Interest avoided',
    riskLevel: 'Low',
    est: [80, 540],
  },
  {
    key: 'copy-watcher',
    classLabel: 'Markets',
    name: 'Pattern Mirror',
    charter:
      'Studies your own winning trades and proposes the repeats, with the exact conditions spelled out before it acts.',
    revenueModel: 'Repeatable edge',
    riskLevel: 'High',
    est: [90, 830],
  },
  {
    key: 'vendor-negotiator',
    classLabel: 'Cash',
    name: 'Vendor Negotiator',
    charter:
      'Benchmarks every recurring vendor against the market and drafts the renegotiation note with the numbers in it.',
    revenueModel: 'Discounts captured',
    riskLevel: 'Low',
    est: [70, 460],
  },
  {
    key: 'subscription-pruner',
    classLabel: 'Insights',
    name: 'Subscription Pruner',
    charter:
      'Finds subscriptions you stopped using, prices the overlap, and proposes the cancellations in one review.',
    revenueModel: 'Spend removed',
    riskLevel: 'Low',
    est: [30, 220],
  },
];

async function draft(bots: any[], limit = 2) {
  const proposals = rows(await store.FoundryProposal.list('-created_date', 500));
  const pending = proposals.filter((item: any) => item.status === 'pending');
  if (pending.length >= PENDING_CAP) return [];

  const taken = new Set([...bots, ...proposals].map((item: any) => slugify(item.slug || item.name || item.title)));
  const fresh = ARCHETYPES.filter((item) => !taken.has(slugify(item.key)));
  const room = Math.max(0, Math.min(Math.max(1, Math.floor(limit) || 2), PENDING_CAP - pending.length));
  const drafted: any[] = [];

  for (const archetype of fresh.slice(0, room)) {
    drafted.push(
      await store.FoundryProposal.create({
        title: archetype.name,
        slug: archetype.key,
        class_label: archetype.classLabel,
        charter: archetype.charter,
        revenue_model: archetype.revenueModel,
        risk_level: archetype.riskLevel,
        est_monthly: estimate(archetype.est),
        status: 'pending',
        source: 'think-bot',
        decided_at: null,
        created_at: now(),
      }),
    );
  }

  if (drafted.length) {
    await logEvent(
      'proposal',
      `Think Bot queued ${drafted.length} new concept${drafted.length > 1 ? 's' : ''} for your decision.`,
      'think',
    );
  }
  return drafted;
}

async function snapshot(bots: any[]) {
  const proposals = rows(await store.FoundryProposal.list('-created_date', 200));
  const events = rows(await store.FoundryEvent.list('-created_date', 40));
  const running = bots.filter((bot: any) => bot.status === 'running');
  const pending = proposals.filter((item: any) => item.status === 'pending');

  return {
    bots: bots
      .filter((bot: any) => bot.status !== 'retired')
      .map((bot: any) => ({
        id: bot.id,
        name: bot.name,
        slug: bot.slug,
        classLabel: bot.class_label,
        charter: bot.charter,
        revenueModel: bot.revenue_model,
        riskLevel: bot.risk_level,
        status: bot.status,
        estMonthly: num(bot.est_monthly),
        lastAction: bot.last_action,
        accountStatus: bot.account_status || 'none',
        accountProvider: bot.account_provider || '',
        accountNeeds: bot.account_needs || '',
        lastRun: bot.last_run || '',
        lastResult: bot.last_result || '',
        createdAt: bot.created_at || bot.created_date,
      })),
    proposals: pending.map((item: any) => ({
      id: item.id,
      title: item.title,
      classLabel: item.class_label,
      charter: item.charter,
      revenueModel: item.revenue_model,
      riskLevel: item.risk_level,
      estMonthly: num(item.est_monthly),
      source: item.source,
      createdAt: item.created_date,
    })),
    events: events.map((event: any) => ({
      id: event.id,
      kind: event.kind,
      message: event.message,
      botSlug: event.bot_slug || '',
      at: event.created_at || event.created_date,
    })),
    totals: {
      running: running.length,
      paused: bots.filter((bot: any) => bot.status === 'paused').length,
      pending: pending.length,
      decided: proposals.filter((item: any) => item.status !== 'pending').length,
      connected: bots.filter((bot: any) => bot.account_status === 'connected').length,
      awaitingAccount: bots.filter((bot: any) => bot.account_status === 'needed').length,
      projected: running.reduce((sum: number, bot: any) => sum + num(bot.est_monthly), 0),
    },
  };
}

async function ownerFor(req: Request) {
  const token = consoleToken(req);
  if (!token) return null;
  const session = rows(await store.BankingSession.filter({ token_hash: await sha256(token) }, undefined, 1))[0];
  if (!session || !(Date.parse(session.expires_at) > Date.now())) return null;
  return rows(await store.BankingOwner.filter({ email: session.owner_email }, undefined, 1))[0] || null;
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('foundryApi failure', error);
    return json(req, { error: 'The foundry hit a problem. Try again in a moment.' }, 500);
  }
});

async function handle(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = String(body.action || 'state');

  if (action === 'generate') {
    const bots = await ensureSeeded();
    const drafted = await draft(bots, num(body.limit) || 2);
    return json(req, { drafted: drafted.length });
  }

  const owner = await ownerFor(req);
  if (!owner) return json(req, { error: LOCKED }, 401);

  if (action === 'state') {
    return json(req, await snapshot(await ensureSeeded()));
  }

  if (action === 'draft') {
    const bots = await ensureSeeded();
    const drafted = await draft(bots, num(body.limit) || 2);
    return json(req, { drafted: drafted.length });
  }

  if (action === 'decide') {
    const proposal = await store.FoundryProposal.get(String(body.proposalId || ''));
    if (!proposal || proposal.status !== 'pending') {
      return json(req, { error: 'That proposal is already gone.' }, 404);
    }

    if (body.decision === 'approve') {
      // A retired bot keeps its slug, so approving a same-slug concept would
      // trip the unique index; give the newcomer a suffixed slug instead.
      const clash = rows(await store.FoundryBot.filter({ slug: proposal.slug }, undefined, 1))[0];
      const slug = clash ? `${proposal.slug}-${Date.now().toString(36)}` : proposal.slug;

      await store.FoundryBot.create({
        name: proposal.title,
        slug,
        class_label: proposal.class_label,
        charter: proposal.charter,
        revenue_model: proposal.revenue_model,
        risk_level: proposal.risk_level,
        status: 'running',
        source: 'approved',
        account_status: 'needed',
        account_provider: '',
        account_needs: 'An account to earn against. Tell the foundry which provider once you have one.',
        last_run: null,
        last_result: '',
        est_monthly: num(proposal.est_monthly),
        last_action: 'Approved from the console, first cycle started.',
        created_at: now(),
      });
      await store.FoundryProposal.update(proposal.id, { status: 'approved', decided_at: now() });
      await logEvent('approved', `You approved ${proposal.title}. It joined the swarm.`, slug);
      return json(req, { ok: true, status: 'approved' });
    }

    if (body.decision === 'reject') {
      await store.FoundryProposal.update(proposal.id, { status: 'rejected', decided_at: now() });
      await logEvent('rejected', `You passed on ${proposal.title}. Think Bot will look elsewhere.`, proposal.slug);
      return json(req, { ok: true, status: 'rejected' });
    }

    return json(req, { error: 'Decide with approve or reject.' }, 400);
  }

  if (action === 'toggle' || action === 'retire') {
    const bot = await store.FoundryBot.get(String(body.botId || ''));
    if (!bot || bot.status === 'retired') return json(req, { error: 'That bot is not in the swarm.' }, 404);

    if (action === 'toggle') {
      const status = bot.status === 'running' ? 'paused' : 'running';
      await store.FoundryBot.update(bot.id, {
        status,
        last_action: status === 'running' ? 'Resumed from the console.' : 'Paused from the console.',
      });
      await logEvent(
        status === 'running' ? 'resumed' : 'paused',
        `${bot.name} ${status === 'running' ? 'resumed' : 'paused'} on your say-so.`,
        bot.slug,
      );
      return json(req, { ok: true, status });
    }

    await store.FoundryBot.update(bot.id, { status: 'retired', last_action: 'Retired from the console.' });
    await logEvent('retired', `You retired ${bot.name}.`, bot.slug);
    return json(req, { ok: true, status: 'retired' });
  }

  return json(req, { error: 'Unknown action.' }, 400);
}
