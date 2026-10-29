import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { authenticate } from '../auth.js'

/**
 * The bot foundry, self-hosted flavour. Mirrors functions/foundryApi.ts: the
 * Think Bot drafts concepts, the owner approves or passes, and only approved
 * bots join the swarm.
 */

const PENDING_CAP = 6

// What each seeded bot needs before it can touch real money.
const ACCOUNT_PLAN = {
  think: ['none', 'none', 'Nothing. Runs on the console alone.'],
  maker: ['none', 'none', 'Nothing. Builds from approved charters.'],
  nft: ['needed', 'OpenSea', 'An OpenSea API key, or your marketplace wallet signature.'],
  buy: ['needed', 'Kraken', 'Trade-only API key with a hard cap.'],
  sell: ['needed', 'Kraken', 'Trade-only API key. Withdrawals stay off.'],
  scraper: ['none', 'public market data', 'Nothing. Reads public prices, no key needed.'],
  maintenance: ['none', 'none', 'Nothing. Watches the swarm itself.'],
  treasury: ['needed', 'Mercury', 'A treasury account with read plus transfer limits.'],
  fraud: ['needed', 'Stripe Radar', 'A payments account to score authorizations against.'],
  payroll: ['needed', 'Gusto', 'Payroll API access and a funding account.'],
  spend: ['needed', 'Plaid', 'A Plaid client id and secret, or a bank export to read.'],
}

export const SEED_BOTS = [
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
]

export const ARCHETYPES = [
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
]

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const estimate = ([low, high]) => Math.round(low + Math.random() * (high - low))

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(tmp, file)
}

export function mountFoundryRoutes(app, store, foundryFile) {
  const file = foundryFile
  const empty = { bots: [], proposals: [], events: [] }
  const read = () => ({ ...empty, ...readJson(file, empty) })
  const write = (state) => writeJson(file, state)

  function logEvent(state, kind, message, botSlug = '') {
    state.events.unshift({
      id: randomUUID(),
      kind,
      message,
      bot_slug: botSlug,
      created_at: new Date().toISOString(),
    })
    state.events = state.events.slice(0, 200)
  }

  function ensureSeeded(state) {
    if (state.bots.length) return state.bots
    for (const seed of SEED_BOTS) {
      state.bots.push({
        id: randomUUID(),
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
        account_status: ACCOUNT_PLAN[seed.key]?.[0] || 'needed',
        account_provider: ACCOUNT_PLAN[seed.key]?.[1] || '',
        account_needs: ACCOUNT_PLAN[seed.key]?.[2] || '',
        last_run: '',
        last_result: '',
        created_at: new Date().toISOString(),
      })
    }
    logEvent(state, 'boot', `Swarm started with ${SEED_BOTS.length} bots. Think Bot is drafting the first proposals.`)
    return state.bots
  }

  function draft(state, limit = 2) {
    const pending = state.proposals.filter((item) => item.status === 'pending')
    if (pending.length >= PENDING_CAP) return []

    const taken = new Set([...state.bots, ...state.proposals].map((item) => slugify(item.slug || item.name)))
    const fresh = ARCHETYPES.filter((item) => !taken.has(slugify(item.key)))
    const drafted = []

    for (const archetype of fresh.slice(0, Math.min(limit, PENDING_CAP - pending.length))) {
      const proposal = {
        id: randomUUID(),
        title: archetype.name,
        slug: archetype.key,
        class_label: archetype.classLabel,
        charter: archetype.charter,
        revenue_model: archetype.revenueModel,
        risk_level: archetype.riskLevel,
        est_monthly: estimate(archetype.est),
        status: 'pending',
        source: 'think-bot',
        decided_at: '',
        created_date: new Date().toISOString(),
      }
      state.proposals.unshift(proposal)
      drafted.push(proposal)
    }

    if (drafted.length) {
      logEvent(state, 'proposal', `Think Bot queued ${drafted.length} new concept${drafted.length > 1 ? 's' : ''} for your decision.`)
    }
    return drafted
  }

  function snapshot(state) {
    const running = state.bots.filter((bot) => bot.status === 'running')
    const proposals = state.proposals.filter((item) => item.status === 'pending')

    return {
      bots: state.bots
        .filter((bot) => bot.status !== 'retired')
        .map((bot) => ({
          id: bot.id,
          name: bot.name,
          slug: bot.slug,
          classLabel: bot.class_label,
          charter: bot.charter,
          revenueModel: bot.revenue_model,
          riskLevel: bot.risk_level,
          status: bot.status,
          estMonthly: bot.est_monthly,
          lastAction: bot.last_action,
          accountStatus: bot.account_status || 'none',
          accountProvider: bot.account_provider || '',
          accountNeeds: bot.account_needs || '',
          lastRun: bot.last_run || '',
          lastResult: bot.last_result || '',
          createdAt: bot.created_at,
        })),
      proposals: proposals.map((item) => ({
        id: item.id,
        title: item.title,
        classLabel: item.class_label,
        charter: item.charter,
        revenueModel: item.revenue_model,
        riskLevel: item.risk_level,
        estMonthly: item.est_monthly,
        source: item.source,
        createdAt: item.created_date,
      })),
      events: state.events.slice(0, 40).map((event) => ({
        id: event.id,
        kind: event.kind,
        message: event.message,
        at: event.created_at,
      })),
      totals: {
        running: running.length,
        paused: state.bots.filter((bot) => bot.status === 'paused').length,
        pending: proposals.length,
        decided: state.proposals.filter((item) => item.status !== 'pending').length,
        connected: state.bots.filter((bot) => bot.account_status === 'connected').length,
        awaitingAccount: state.bots.filter((bot) => bot.account_status === 'needed').length,
        projected: running.reduce((sum, bot) => sum + (bot.est_monthly || 0), 0),
      },
    }
  }

  function ownerOnly(req, res) {
    const auth = authenticate(req, store)
    if (!auth) {
      res.status(401).json({ error: 'Your session has expired. Sign in again.' })
      return null
    }
    return auth
  }

  function handle(req, res) {
    const action = String(req.body?.action || 'state')

    if (action === 'generate') {
      const state = read()
      ensureSeeded(state)
      const drafted = draft(state, Number(req.body?.limit) || 2)
      write(state)
      return res.json({ drafted: drafted.length })
    }

    if (!ownerOnly(req, res)) return undefined

    const state = read()

    if (action === 'state') {
      ensureSeeded(state)
      write(state)
      return res.json(snapshot(state))
    }

    if (action === 'draft') {
      ensureSeeded(state)
      const drafted = draft(state, Number(req.body?.limit) || 2)
      write(state)
      return res.json({ drafted: drafted.length })
    }

    if (action === 'decide') {
      const proposal = state.proposals.find((item) => item.id === req.body?.proposalId)
      if (!proposal) return res.status(404).json({ error: 'That proposal is already gone.' })

      if (req.body?.decision === 'approve') {
        state.bots.unshift({
          id: randomUUID(),
          name: proposal.title,
          slug: proposal.slug,
          class_label: proposal.class_label,
          charter: proposal.charter,
          revenue_model: proposal.revenue_model,
          risk_level: proposal.risk_level,
          status: 'running',
          source: 'approved',
          account_status: 'needed',
          account_provider: '',
          account_needs: 'An account to earn against. Tell the foundry which provider once you have one.',
          last_run: '',
          last_result: '',
          est_monthly: proposal.est_monthly,
          last_action: 'Approved from the console, first cycle started.',
          created_at: new Date().toISOString(),
        })
        proposal.status = 'approved'
        proposal.decided_at = new Date().toISOString()
        logEvent(state, 'approved', `You approved ${proposal.title}. It joined the swarm.`, proposal.slug)
        write(state)
        return res.json({ ok: true, status: 'approved' })
      }

      if (req.body?.decision === 'reject') {
        proposal.status = 'rejected'
        proposal.decided_at = new Date().toISOString()
        logEvent(state, 'rejected', `You passed on ${proposal.title}. Think Bot will look elsewhere.`, proposal.slug)
        write(state)
        return res.json({ ok: true, status: 'rejected' })
      }

      return res.status(400).json({ error: 'Decide with approve or reject.' })
    }

    const bot = state.bots.find((item) => item.id === req.body?.botId)
    if (!bot) return res.status(404).json({ error: 'That bot is not in the swarm.' })

    if (action === 'toggle') {
      bot.status = bot.status === 'running' ? 'paused' : 'running'
      bot.last_action = bot.status === 'running' ? 'Resumed from the console.' : 'Paused from the console.'
      logEvent(state, bot.status === 'running' ? 'resumed' : 'paused', `${bot.name} ${bot.status === 'running' ? 'resumed' : 'paused'} on your say-so.`, bot.slug)
      write(state)
      return res.json({ ok: true, status: bot.status })
    }

    if (action === 'retire') {
      bot.status = 'retired'
      bot.last_action = 'Retired from the console.'
      logEvent(state, 'retired', `You retired ${bot.name}.`, bot.slug)
      write(state)
      return res.json({ ok: true, status: 'retired' })
    }

    return res.status(400).json({ error: 'Unknown action.' })
  }

  async function desk(req, res) {
    if (!ownerOnly(req, res)) return undefined

    const action = String(req.body?.action || 'state')
    const state = read()

    if (action === 'feed') {
      let prices
      try {
        const response = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD', {
          headers: { accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`feed responded ${response.status}`)
        prices = await response.json()
      } catch {
        return res.status(502).json({ error: 'The public price feed did not answer. Try again shortly.' })
      }

      const pairs = [
        ['BTC', 'XXBTZUSD'],
        ['ETH', 'XETHZUSD'],
        ['SOL', 'SOLUSD'],
      ]
      const line = pairs
        .filter(([, pair]) => prices?.result?.[pair]?.c?.[0])
        .map(([label, pair]) => `${label} $${Number(prices.result[pair].c[0]).toLocaleString('en-US')}`)
        .join(' · ')
      const when = new Date().toISOString()
      const scraper = state.bots.find((bot) => bot.slug === 'scraper')

      if (scraper) {
        scraper.last_run = when
        scraper.last_result = line
      }
      logEvent(state, 'feed', `Scraper Bot read the live market: ${line}.`, 'scraper')
      write(state)
      return res.json({ line, prices, at: when })
    }

    if (action === 'setAccount') {
      const bot = state.bots.find((item) => item.id === req.body?.botId)
      if (!bot) return res.status(404).json({ error: 'That bot is not in the swarm.' })

      const status = String(req.body?.status || '')
      if (!['none', 'needed', 'connected'].includes(status)) {
        return res.status(400).json({ error: 'Use none, needed or connected.' })
      }

      bot.account_status = status
      bot.last_action =
        status === 'connected'
          ? `Account confirmed on ${bot.account_provider || 'a live provider'}. Ready for its first live cycle.`
          : `Waiting on an account${bot.account_provider ? ` with ${bot.account_provider}` : ''}.`
      logEvent(
        state,
        'account',
        status === 'connected' ? `${bot.name} has a live account on ${bot.account_provider}.` : `${bot.name} is waiting on its account.`,
        bot.slug,
      )
      write(state)
      return res.json({ ok: true, status })
    }

    ensureSeeded(state)
    write(state)
    return res.json(snapshot(state))
  }

  const router = Router()
  router.post('/foundry', handle)
  app.use('/api', router)
  app.post('/api/foundryApi', handle)
  app.post('/api/foundryOps', desk)
}
