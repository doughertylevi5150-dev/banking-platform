import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * Accounts, money and activity desk for the foundry.
 *
 * Actions: state · activity · bot · treasury · keys · live · record · feed · setAccount · tick
 * Everything except `tick` needs the owner's session.
 *
 * Providers are wired, not simulated: when the owner stores a provider key as a
 * secret, `live` performs the real authenticated read and the balance lands in
 * the treasury. When a key is missing the desk says so plainly instead of
 * pretending the bot is trading.
 */

const LOCKED = 'This console is limited to its owner.';

const headers = (req: Request) => ({
  'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
const r2 = (value: number) => Math.round(value * 100) / 100;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)));

function unb64(value: string) {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

type Provider = {
  id: string;
  label: string;
  env: string[];
  wired: boolean;
  note: string;
  keyPage: string;
  bots: string[];
};

const PROVIDERS: Provider[] = [
  {
    id: 'kraken',
    label: 'Kraken',
    env: ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET'],
    wired: true,
    note: 'Live balances and open orders. Trade-only keys; withdrawals stay off.',
    keyPage: 'https://pro.kraken.com/app/settings/api',
    bots: ['buy', 'sell', 'arbitrage-scout', 'copy-watcher'],
  },
  {
    id: 'stripe',
    label: 'Stripe',
    env: ['STRIPE_SECRET_KEY'],
    wired: true,
    note: 'Live balance and recent charges for Fraud Watch.',
    keyPage: 'https://dashboard.stripe.com/apikeys',
    bots: ['fraud'],
  },
  {
    id: 'mercury',
    label: 'Mercury',
    env: ['MERCURY_API_TOKEN'],
    wired: true,
    note: 'Treasury account balances, read only until you allow transfers.',
    keyPage: 'https://app.mercury.com/settings/api',
    bots: ['treasury', 'yield-router', 'payroll'],
  },
  {
    id: 'opensea',
    label: 'OpenSea',
    env: ['OPENSEA_API_KEY'],
    wired: false,
    note: 'Key stored; the collection sweep still needs your wallet address.',
    keyPage: 'https://opensea.io/settings/developer',
    bots: ['nft', 'listing-ladder'],
  },
  {
    id: 'gusto',
    label: 'Gusto',
    env: ['GUSTO_CLIENT_ID', 'GUSTO_CLIENT_SECRET'],
    wired: false,
    note: 'Key stored; payroll windows need the company id to file against.',
    keyPage: 'https://dev.gusto.com',
    bots: ['payroll'],
  },
  {
    id: 'plaid',
    label: 'Plaid',
    env: ['PLAID_CLIENT_ID', 'PLAID_CLIENT_SECRET'],
    wired: false,
    note: 'Key stored; Spend Analyst also needs one linked bank item.',
    keyPage: 'https://dashboard.plaid.com/team/keys',
    bots: ['spend', 'fee-auditor', 'subscription-pruner'],
  },
];

function providerStatus() {
  return PROVIDERS.map((provider) => {
    const present = provider.env.filter((name) => Boolean(Deno.env.get(name)));
    return {
      id: provider.id,
      label: provider.label,
      env: provider.env,
      present: present.length,
      connected: present.length === provider.env.length,
      wired: provider.wired,
      note: provider.note,
      keyPage: provider.keyPage,
      bots: provider.bots,
    };
  });
}

// Kraken's public ticker needs no key and does not rate-limit the swarm.
const FEED = 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD';

const PAIRS: [string, string][] = [
  ['BTC', 'XXBTZUSD'],
  ['ETH', 'XETHZUSD'],
  ['SOL', 'SOLUSD'],
];

async function readPrices() {
  const response = await fetch(FEED, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`feed responded ${response.status}`);

  const payload = await response.json();
  if (Array.isArray(payload?.error) && payload.error.length) throw new Error(String(payload.error[0]));

  const prices: Record<string, number> = {};
  for (const [label, pair] of PAIRS) {
    const last = payload?.result?.[pair]?.c?.[0];
    if (last) prices[label] = Number(last);
  }

  if (!Object.keys(prices).length) throw new Error('feed returned no pairs');
  return prices;
}

function priceLine(prices: Record<string, number>) {
  return PAIRS.filter(([label]) => prices[label])
    .map(([label]) => `${label} $${prices[label].toLocaleString('en-US')}`)
    .join(' · ');
}

/** Kraken private calls: nonce, urlencoded body, HMAC-SHA512 over path + sha256(nonce + body). */
async function krakenPrivate(path: string, params: Record<string, string> = {}) {
  const key = Deno.env.get('KRAKEN_API_KEY') || '';
  const secret = Deno.env.get('KRAKEN_API_SECRET') || '';
  if (!key || !secret) throw new Error('Kraken key is not stored yet.');

  const post = params;
  post.nonce = `${Date.now()}000`;
  const body = new URLSearchParams(post).toString();
  const message = path + await sha256(post.nonce + body);

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    unb64(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const signature = b64(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(message)));

  const response = await fetch(`https://api.kraken.com${path}`, {
    method: 'POST',
    headers: {
      'API-Key': key,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Kraken responded ${response.status}`);
  if (Array.isArray(payload?.error) && payload.error.length) throw new Error(String(payload.error[0]));
  return payload?.result || {};
}

const KRAKEN_NAMES: Record<string, string> = {
  ZUSD: 'USD',
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XXDG: 'DOGE',
  XDG: 'DOGE',
};

async function krakenBalances(prices: Record<string, number>) {
  const result = await krakenPrivate('/0/private/Balance');
  const holdings = Object.entries(result)
    .map(([asset, amount]) => {
      const symbol = KRAKEN_NAMES[asset] || asset.replace(/^X{1,2}/, '');
      const units = num(amount);
      const usd = prices[symbol] ? units * prices[symbol] : symbol === 'USD' ? units : 0;
      return { asset: symbol, units, usd: r2(usd), priced: Boolean(prices[symbol]) || symbol === 'USD' };
    })
    .filter((holding) => holding.units > 0)
    .sort((a, b) => b.usd - a.usd);

  return { provider: 'Kraken', holdings, total: r2(holdings.reduce((sum, item) => sum + item.usd, 0)) };
}

async function stripeBalances() {
  const key = Deno.env.get('STRIPE_SECRET_KEY') || '';
  if (!key) throw new Error('Stripe key is not stored yet.');

  const response = await fetch('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${key}`, accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Stripe responded ${response.status}`);

  const payload: any = await response.json();
  const total = (payload?.available || []).reduce((sum: number, entry: any) => sum + num(entry.amount) / 100, 0);
  return {
    provider: 'Stripe',
    holdings: [{ asset: (payload?.available?.[0]?.currency || 'usd').toUpperCase(), units: r2(total), usd: r2(total), priced: true }],
    total: r2(total),
  };
}

async function mercuryBalances() {
  const token = Deno.env.get('MERCURY_API_TOKEN') || '';
  if (!token) throw new Error('Mercury token is not stored yet.');

  const response = await fetch('https://api.mercury.com/api/v1/accounts', {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Mercury responded ${response.status}`);

  const payload: any = await response.json();
  const accounts = payload?.accounts || [];
  const holdings = accounts
    .map((account: any) => ({
      asset: account.nickname || account.name || 'Mercury account',
      units: r2(num(account.currentBalance)),
      usd: r2(num(account.currentBalance)),
      priced: true,
    }))
    .filter((holding: any) => holding.usd !== 0);

  return { provider: 'Mercury', holdings, total: r2(holdings.reduce((sum: number, item: any) => sum + item.usd, 0)) };
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

// Accounts each seeded bot needs. Bots created before the ledger existed get
// adopted on first read so their status is never blank in the console.
const ACCOUNT_PLAN: Record<string, [string, string, string]> = {
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

async function adoptAccounts(store: any, bots: any[]) {
  for (const bot of bots) {
    if (bot.account_status) continue;
    const plan = ACCOUNT_PLAN[bot.slug];
    if (!plan) continue;
    const [status, provider, needs] = plan;
    await store.FoundryBot.update(bot.id, {
      account_status: status,
      account_provider: provider,
      account_needs: needs,
    });
    bot.account_status = status;
    bot.account_provider = provider;
    bot.account_needs = needs;
  }
  return bots;
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

async function ledgerRows(store: any, limit = 300) {
  return rows(await store.FoundryLedger.list('-created_date', limit));
}

function tally(entries: any[], botSlug?: string) {
  const scoped = botSlug ? entries.filter((entry: any) => entry.bot_slug === botSlug) : entries;
  const earnings = scoped.filter((entry: any) => entry.kind === 'earning');
  const expenses = scoped.filter((entry: any) => entry.kind === 'expense');
  const cashIn = earnings.reduce((sum: number, entry: any) => sum + num(entry.amount), 0);
  const cashOut = expenses.reduce((sum: number, entry: any) => sum + num(entry.amount), 0);
  return {
    cashIn: r2(cashIn),
    cashOut: r2(cashOut),
    net: r2(cashIn - cashOut),
    entries: scoped.length,
    lastAt: scoped[0]?.occurred_at || scoped[0]?.created_at || '',
  };
}

function perBot(entries: any[]) {
  const map = new Map<string, any>();
  for (const entry of entries) {
    const slug = entry.bot_slug || 'unassigned';
    const current = map.get(slug) || { earned: 0, spent: 0, entries: 0, lastAt: '' };
    const amount = num(entry.amount);
    if (entry.kind === 'earning') current.earned += amount;
    if (entry.kind === 'expense') current.spent += amount;
    current.entries += 1;
    const at = entry.occurred_at || entry.created_at || '';
    if (at > current.lastAt) current.lastAt = at;
    map.set(slug, current);
  }
  return map;
}

async function buildTreasury(store: any) {
  const entries = await ledgerRows(store);
  const bots = rows(await store.FoundryBot.list(undefined, 200));
  const byBot = perBot(entries);
  const totals = tally(entries);

  const raised = entries.filter((entry: any) => entry.kind === 'transfer');
  const raisedTotal = raised.reduce((sum: number, entry: any) => sum + Math.abs(num(entry.amount)), 0);

  const valuation = entries
    .filter((entry: any) => entry.kind === 'valuation')
    .sort((a: any, b: any) => String(b.occurred_at || b.created_at).localeCompare(String(a.occurred_at || a.created_at)))[0];

  return {
    cashIn: totals.cashIn,
    cashOut: totals.cashOut,
    net: totals.net,
    ledgerBalance: totals.net,
    raised: r2(raisedTotal),
    liveBalance: r2(num(valuation?.amount)),
    liveAt: valuation?.occurred_at || '',
    liveProvider: valuation?.source || '',
    entries: entries.slice(0, 60).map((entry: any) => ({
      id: entry.id,
      botSlug: entry.bot_slug || '',
      kind: entry.kind,
      amount: num(entry.amount),
      currency: entry.currency || 'USD',
      note: entry.note || '',
      source: entry.source || '',
      at: entry.occurred_at || entry.created_at,
    })),
    byBot: bots
      .filter((bot: any) => bot.status !== 'retired')
      .map((bot: any) => {
        const row = byBot.get(bot.slug) || { earned: 0, spent: 0, entries: 0, lastAt: '' };
        return {
          slug: bot.slug,
          name: bot.name,
          classLabel: bot.class_label,
          status: bot.status,
          earned: r2(row.earned),
          spent: r2(row.spent),
          entries: row.entries,
          lastAt: row.lastAt,
          estMonthly: num(bot.est_monthly),
        };
      })
      .sort((a: any, b: any) => b.earned - a.earned || b.estMonthly - a.estMonthly),
  };
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('foundryOps failure', error);
    return json(req, { error: 'The account desk hit a problem. Try again in a moment.' }, 500);
  }
});

async function handle(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  const base44 = createClientFromRequest(req);
  const store = base44.asServiceRole.entities as any;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const header = req.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  let owner = null;

  if (token && scheme.toLowerCase() === 'bearer') {
    const session = rows(await store.BankingSession.filter({ token_hash: await sha256(token) }, undefined, 1))[0];
    if (session && Date.parse(session.expires_at) > Date.now()) {
      owner = rows(await store.BankingOwner.filter({ email: session.owner_email }, undefined, 1))[0] || null;
    }
  }

  const action = String(body.action || 'state');

  if (action === 'tick') {
    // Public but bounded: one read per five minutes, so the scheduler keeps the
    // feed warm without letting a stranger spam the log.
    const recent = rows(await store.FoundryEvent.list('-created_date', 5));
    const last = recent.find((event: any) => event.kind === 'feed');
    const at = last ? Date.parse(last.created_at || last.created_date) : 0;
    if (at && Date.now() - at < 5 * 60 * 1000) return json(req, { skipped: true, at: new Date(at).toISOString() });

    const prices = await readPrices();
    const line = priceLine(prices);
    const when = new Date().toISOString();
    const scraper = rows(await store.FoundryBot.filter({ slug: 'scraper' }, undefined, 1))[0];
    if (scraper) await store.FoundryBot.update(scraper.id, { last_run: when, last_result: line });
    await store.FoundryEvent.create({
      kind: 'feed',
      message: `Scraper Bot read the live market: ${line}.`,
      bot_slug: 'scraper',
      created_at: when,
    });
    return json(req, { line, at: when });
  }

  if (!owner) return json(req, { error: LOCKED }, 401);

  if (action === 'feed') {
    let prices: Record<string, number>;
    try {
      prices = await readPrices();
    } catch (problem) {
      console.error('feed failed', problem);
      return json(req, { error: 'The public price feed did not answer. Try again shortly.' }, 502);
    }

    const line = priceLine(prices);
    const when = new Date().toISOString();
    const scraper = rows(await store.FoundryBot.filter({ slug: 'scraper' }, undefined, 1))[0];

    if (scraper) await store.FoundryBot.update(scraper.id, { last_run: when, last_result: line });
    await store.FoundryEvent.create({
      kind: 'feed',
      message: `Scraper Bot read the live market: ${line}.`,
      bot_slug: 'scraper',
      created_at: when,
    });

    return json(req, { line, prices, at: when });
  }

  if (action === 'setAccount') {
    const bot = rows(await store.FoundryBot.filter({ id: body.botId }, undefined, 1))[0];
    if (!bot) return json(req, { error: 'That bot is not in the swarm.' }, 404);

    const status = String(body.status || '');
    if (!['none', 'needed', 'connected'].includes(status)) {
      return json(req, { error: 'Use none, needed or connected.' }, 400);
    }

    const provider = String(body.provider || bot.account_provider || '').slice(0, 80);
    const lastAction =
      status === 'connected'
        ? `Account confirmed on ${provider || 'a live provider'}. Ready for its first live cycle.`
        : status === 'needed'
          ? `Waiting on an account${provider ? ` with ${provider}` : ''}.`
          : bot.last_action;

    await store.FoundryBot.update(bot.id, {
      account_status: status,
      account_provider: provider,
      last_action: lastAction,
    });

    await store.FoundryEvent.create({
      kind: 'account',
      message:
        status === 'connected'
          ? `${bot.name} has a live account on ${provider || 'a provider'}.`
          : `${bot.name} is waiting on its account.`,
      bot_slug: bot.slug,
      created_at: new Date().toISOString(),
    });

    return json(req, { ok: true, status, provider });
  }

  if (action === 'state') {
    const bots = await adoptAccounts(store, rows(await store.FoundryBot.list(undefined, 100)));
    const proposals = rows(await store.FoundryProposal.list('-created_date', 100));
    const events = rows(await store.FoundryEvent.list('-created_date', 40));
    const live = bots.filter((bot: any) => bot.status === 'running');
    const entries = await ledgerRows(store);
    const byBot = perBot(entries);
    const money = tally(entries);
    const providers = providerStatus();
    const connected = providers.filter((provider) => provider.connected).length;

    return json(req, {
      bots: bots
        .filter((bot: any) => bot.status !== 'retired')
        .map((bot: any) => {
          const row = byBot.get(bot.slug) || { earned: 0, spent: 0, entries: 0, lastAt: '' };
          return {
            id: bot.id,
            name: bot.name,
            slug: bot.slug,
            classLabel: bot.class_label,
            charter: bot.charter,
            revenueModel: bot.revenue_model,
            riskLevel: bot.risk_level,
            status: bot.status,
            estMonthly: Number(bot.est_monthly) || 0,
            lastAction: bot.last_action,
            accountStatus: bot.account_status || 'none',
            accountProvider: bot.account_provider || '',
            accountNeeds: bot.account_needs || '',
            lastRun: bot.last_run || '',
            lastResult: bot.last_result || '',
            earned: r2(row.earned),
            spent: r2(row.spent),
            ledgerEntries: row.entries,
            lastEarnedAt: row.lastAt,
          };
        }),
      proposals: proposals
        .filter((item: any) => item.status === 'pending')
        .map((item: any) => ({
          id: item.id,
          title: item.title,
          classLabel: item.class_label,
          charter: item.charter,
          revenueModel: item.revenue_model,
          riskLevel: item.risk_level,
          estMonthly: Number(item.est_monthly) || 0,
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
      providers,
      money: { ...money, liveBalance: r2(num(entries.filter((entry: any) => entry.kind === 'valuation')[0]?.amount)) },
      totals: {
        running: live.length,
        paused: bots.filter((bot: any) => bot.status === 'paused').length,
        pending: proposals.filter((item: any) => item.status === 'pending').length,
        decided: proposals.filter((item: any) => item.status !== 'pending').length,
        connected: bots.filter((bot: any) => bot.account_status === 'connected').length,
        awaitingAccount: bots.filter((bot: any) => bot.account_status === 'needed').length,
        keysLive: connected,
        keysTotal: providers.length,
        projected: live.reduce((sum: number, bot: any) => sum + (Number(bot.est_monthly) || 0), 0),
        earned: money.cashIn,
        net: money.net,
      },
    });
  }

  if (action === 'activity') {
    const all = rows(await store.FoundryEvent.list('-created_date', 300));
    const slug = String(body.botSlug || '');
    const kind = String(body.kind || '');
    const open = all.filter((event: any) => {
      if (slug && event.bot_slug !== slug) return false;
      if (kind && event.kind !== kind) return false;
      return true;
    });

    const limit = Math.min(Math.max(Number(body.limit) || 80, 1), 300);
    const skip = Math.max(Number(body.skip) || 0, 0);
    const page = open.slice(skip, skip + limit);
    const bots = rows(await store.FoundryBot.list(undefined, 200));
    const names = new Map(bots.map((bot: any) => [bot.slug, bot.name]));

    const kinds = [...new Set(all.map((event: any) => event.kind))].filter(Boolean).sort();
    const days = new Set<string>();
    for (const event of all) {
      const at = event.created_at || event.created_date;
      if (at) days.add(String(at).slice(0, 10));
    }

    return json(req, {
      events: page.map((event: any) => ({
        id: event.id,
        kind: event.kind,
        message: event.message,
        botSlug: event.bot_slug || '',
        botName: names.get(event.bot_slug) || 'The console',
        at: event.created_at || event.created_date,
      })),
      total: open.length,
      hasMore: skip + page.length < open.length,
      skip,
      kinds,
      days: [...days].sort().reverse(),
      bots: bots
        .filter((bot: any) => bot.status !== 'retired')
        .map((bot: any) => ({ slug: bot.slug, name: bot.name, classLabel: bot.class_label })),
    });
  }

  if (action === 'bot') {
    const key = String(body.slug || body.botId || '');
    const bots = rows(await store.FoundryBot.list(undefined, 200));
    const bot = bots.find((item: any) => item.slug === key || item.id === key);
    if (!bot) return json(req, { error: 'That bot is not in the swarm.' }, 404);

    const events = rows(await store.FoundryEvent.filter({ bot_slug: bot.slug }, '-created_date', 60));
    const entries = rows(await store.FoundryLedger.filter({ bot_slug: bot.slug }, '-created_date', 60));
    const money = tally(entries);
    const providers = providerStatus().filter((provider) => provider.bots.includes(bot.slug));

    return json(req, {
      bot: {
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
        earned: money.cashIn,
        spent: money.cashOut,
        net: money.net,
      },
      events: events.map((event: any) => ({
        id: event.id,
        kind: event.kind,
        message: event.message,
        at: event.created_at || event.created_date,
      })),
      entries: entries.map((entry: any) => ({
        id: entry.id,
        kind: entry.kind,
        amount: num(entry.amount),
        note: entry.note || '',
        source: entry.source || '',
        at: entry.occurred_at || entry.created_at,
      })),
      providers,
    });
  }

  if (action === 'funding') {
    const records = await ensureFunding(store);
    return json(req, fundingView(records));
  }

  if (action === 'updateFunding') {
    const route = String(body.route || '');
    const status = String(body.status || '');
    if (!FUNDING_STATUSES.includes(status)) return json(req, { error: 'Unknown funding status.' }, 400);
    if (!FUNDING_ROUTES.some((item) => item.route === route)) return json(req, { error: 'Unknown funding route.' }, 404);

    await ensureFunding(store);
    const record = rows(await store.FoundryFunding.filter({ route }, undefined, 1))[0];
    if (!record) return json(req, { error: 'That route is not in the ledger.' }, 404);

    await store.FoundryFunding.update(record.id, {
      status,
      notes: body.note ? String(body.note).slice(0, 400) : record.notes || '',
    });

    const title = FUNDING_ROUTES.find((item) => item.route === route)?.title || route;
    const words: Record<string, string> = {
      preparing: `Fund Bot started the packet for ${title}.`,
      ready: `Fund Bot finished the ${title} packet. It is ready for your signature.`,
      filed: `You filed ${title}. Fund Bot is tracking the decision window.`,
      approved: `${title} came through. Fund Bot booked it in the treasury.`,
      declined: `${title} was declined. Fund Bot is swapping in a different route.`,
      skipped: `You passed on ${title}.`,
      idea: `${title} moved back to the idea pile.`,
    };

    await store.FoundryEvent.create({
      kind: 'funding',
      message: words[status] || `${title} moved to ${status}.`,
      bot_slug: 'fund',
      created_at: new Date().toISOString(),
    });

    if (status === 'approved') {
      const amount = num(FUNDING_ROUTES.find((item) => item.route === route)?.est_amount);
      if (amount) {
        await store.FoundryLedger.create({
          bot_slug: 'treasury',
          kind: 'transfer',
          amount,
          currency: 'USD',
          note: `Funding received: ${title}`,
          source: 'funding',
          occurred_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
      }
    }

    const records = rows(await store.FoundryFunding.list(undefined, 200));
    return json(req, { ok: true, ...fundingView(records) });
  }

  if (action === 'treasury') {
    return json(req, await buildTreasury(store));
  }

  if (action === 'keys') {
    return json(req, { providers: providerStatus() });
  }

  if (action === 'live') {
    // Real authenticated reads. Whatever answers lands in the ledger as a
    // valuation so the treasury shows money that actually exists.
    const results: any[] = [];
    let prices: Record<string, number> = {};
    try {
      prices = await readPrices();
    } catch {
      prices = {};
    }

    const wanted = String(body.provider || '');
    const attempt = async (id: string, run: () => Promise<any>) => {
      if (wanted && wanted !== id) return;
      try {
        const result = await run();
        results.push({ id, ok: true, ...result });
      } catch (problem) {
        results.push({ id, ok: false, error: problem instanceof Error ? problem.message : String(problem) });
      }
    };

    await attempt('kraken', () => krakenBalances(prices));
    await attempt('stripe', stripeBalances);
    await attempt('mercury', mercuryBalances);

    const ok = results.filter((item) => item.ok);
    const total = r2(ok.reduce((sum, item) => sum + num(item.total), 0));
    const when = new Date().toISOString();

    if (ok.length) {
      await store.FoundryLedger.create({
        bot_slug: 'treasury',
        kind: 'valuation',
        amount: total,
        currency: 'USD',
        note: ok.map((item) => `${item.provider} $${num(item.total).toLocaleString('en-US')}`).join(' · '),
        source: ok.map((item) => item.provider).join(' + '),
        occurred_at: when,
        created_at: when,
      });
      await store.FoundryEvent.create({
        kind: 'live',
        message: `Live read across ${ok.map((item) => item.provider).join(', ')}: $${total.toLocaleString('en-US')} in the accounts.`,
        bot_slug: 'treasury',
        created_at: when,
      });
    } else {
      await store.FoundryEvent.create({
        kind: 'live',
        message: `No provider answered a live read yet (${results.map((item) => `${item.id}: ${item.error}`).join('; ')}).`,
        bot_slug: 'treasury',
        created_at: when,
      });
    }

    return json(req, { at: when, total, results });
  }

  if (action === 'record') {
    const slug = String(body.botSlug || '');
    const kind = String(body.kind || 'earning');
    const amount = r2(num(body.amount));
    if (!['earning', 'expense'].includes(kind)) return json(req, { error: 'Record an earning or an expense.' }, 400);
    if (!amount || Math.abs(amount) > 10_000_000) return json(req, { error: 'Give a real amount.' }, 400);

    const bots = rows(await store.FoundryBot.list(undefined, 200));
    const bot = bots.find((item: any) => item.slug === slug) || null;
    const when = new Date().toISOString();

    await store.FoundryLedger.create({
      bot_slug: slug || 'treasury',
      kind,
      amount: kind === 'expense' ? -Math.abs(amount) : Math.abs(amount),
      currency: String(body.currency || 'USD').slice(0, 8).toUpperCase(),
      note: String(body.note || '').slice(0, 240),
      source: 'manual',
      occurred_at: when,
      created_at: when,
    });

    if (bot) {
      await store.FoundryBot.update(bot.id, {
        last_action:
          kind === 'earning'
            ? `Booked $${Math.abs(amount).toLocaleString('en-US')} in earnings.`
            : `Booked $${Math.abs(amount).toLocaleString('en-US')} in costs.`,
      });
    }

    await store.FoundryEvent.create({
      kind: kind === 'earning' ? 'earning' : 'expense',
      message: `${bot ? bot.name : 'Treasury'} ${kind === 'earning' ? 'earned' : 'spent'} $${Math.abs(amount).toLocaleString('en-US')}${body.note ? `: ${String(body.note).slice(0, 120)}` : '.'}`,
      bot_slug: slug,
      created_at: when,
    });

    return json(req, { ok: true, at: when });
  }

  return json(req, { error: 'Unknown action.' }, 400);
}
