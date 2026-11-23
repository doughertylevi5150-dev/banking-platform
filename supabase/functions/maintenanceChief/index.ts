import { CORS_ALLOW_HEADERS, consoleToken, store } from '../_shared/store.ts';
import { ACCOUNT_PLAN, ensureSeeded, now } from '../_shared/foundry.ts';

/**
 * The maintenance chief: one owner-only self-audit per console load
 * (client/src/lib/swarmTick.js runMaintenanceOnce, which ignores failures and
 * only needs a JSON body back).
 *
 * The Base44 original is not in the repo and server/ has no version, so this
 * is a fresh implementation of what the commit history describes ("audits the
 * roster every time the universe is opened"):
 *
 *   1. checks every console table answers;
 *   2. seeds the starting swarm if foundry_bot is empty (shared with foundryApi);
 *   3. trims expired banking_session rows and lapsed banking_attempt windows;
 *   4. audits the roster: blank account fields adopted from ACCOUNT_PLAN,
 *      running bots with no charter, a stale market feed;
 *   5. stamps Maintenance Bot and logs one `maintenance` event, at most once
 *      per MIN_GAP so repeated console loads do not flood the activity log.
 *
 * Response: { ok, status: 'healthy' | 'attention' | 'degraded', at, skipped,
 *             tables: [{ table, ok, error? }], trimmed: { sessions, attempts },
 *             seeded, roster: {...}, issues: string[], note }
 */

const LOCKED = 'This console is limited to its owner.';
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // same as bankingAuth
const MIN_GAP_MS = 10 * 60 * 1000;
const FEED_STALE_MS = 2 * 60 * 60 * 1000;
const TRIM_BATCH = 500;

const TABLES = [
  'BankingOwner',
  'BankingSession',
  'BankingAttempt',
  'FoundryBot',
  'FoundryProposal',
  'FoundryEvent',
  'FoundryLedger',
  'FoundryFunding',
  'PlaidItem',
];

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

const snake = (entity: string) => entity.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ownerFor(req: Request) {
  const token = consoleToken(req);
  if (!token) return null;
  const session = rows(await store.BankingSession.filter({ token_hash: await sha256(token) }, undefined, 1))[0];
  if (!session || !(Date.parse(session.expires_at) > Date.now())) return null;
  return rows(await store.BankingOwner.filter({ email: session.owner_email }, undefined, 1))[0] || null;
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('maintenanceChief failure', error);
    return json(req, { error: 'The maintenance pass hit a problem. The next console load tries again.' }, 500);
  }
});

async function handle(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  const owner = await ownerFor(req);
  if (!owner) return json(req, { error: LOCKED }, 401);

  const at = now();
  const issues: string[] = [];

  // 1. Tables
  const tables = await Promise.all(
    TABLES.map(async (entity) => {
      try {
        await store[entity].list(undefined, 1);
        return { table: snake(entity), ok: true };
      } catch (problem) {
        issues.push(`${snake(entity)} did not answer.`);
        return { table: snake(entity), ok: false, error: String((problem as Error)?.message || problem).slice(0, 200) };
      }
    }),
  );
  const tableDown = tables.some((table) => !table.ok);

  // 2. Seed
  let seeded = 0;
  let bots: any[] = [];
  if (tables.find((table) => table.table === 'foundry_bot')?.ok) {
    const before = rows(await store.FoundryBot.list(undefined, 1)).length;
    bots = await ensureSeeded();
    if (!before) seeded = bots.length;
  }

  // 3. Trim
  const trimmed = { sessions: 0, attempts: 0 };
  try {
    const sessions = rows(await store.BankingSession.list('expires_at', TRIM_BATCH));
    for (const session of sessions) {
      if (Date.parse(session.expires_at) > Date.now()) break; // sorted ascending
      await store.BankingSession.delete(session.id);
      trimmed.sessions += 1;
    }
  } catch (problem) {
    issues.push('Could not trim expired sessions.');
    console.warn('session trim', String(problem));
  }
  try {
    const attempts = rows(await store.BankingAttempt.list('window_start', TRIM_BATCH));
    for (const attempt of attempts) {
      if (Date.parse(attempt.window_start) + ATTEMPT_WINDOW_MS > Date.now()) break;
      await store.BankingAttempt.delete(attempt.id);
      trimmed.attempts += 1;
    }
  } catch (problem) {
    issues.push('Could not trim old sign-in attempts.');
    console.warn('attempt trim', String(problem));
  }

  // 4. Roster audit
  let adopted = 0;
  for (const bot of bots) {
    if (bot.account_status) continue;
    const plan = ACCOUNT_PLAN[bot.slug];
    if (!plan) continue;
    await store.FoundryBot.update(bot.id, { account_status: plan[0], account_provider: plan[1], account_needs: plan[2] });
    bot.account_status = plan[0];
    adopted += 1;
  }
  const active = bots.filter((bot) => bot.status !== 'retired');
  const running = active.filter((bot) => bot.status === 'running');
  const noCharter = running.filter((bot) => !String(bot.charter || '').trim());
  if (noCharter.length) issues.push(`${noCharter.map((bot) => bot.name).join(', ')} running without a charter.`);

  const scraper = bots.find((bot) => bot.slug === 'scraper');
  const feedAt = scraper?.last_run ? Date.parse(scraper.last_run) : 0;
  const feedStale = Boolean(scraper && scraper.status === 'running' && (!feedAt || Date.now() - feedAt > FEED_STALE_MS));
  if (feedStale) issues.push('Market feed has not been read in over two hours.');

  const roster = {
    total: active.length,
    running: running.length,
    paused: active.filter((bot) => bot.status === 'paused').length,
    awaitingAccount: active.filter((bot) => bot.account_status === 'needed').length,
    connected: active.filter((bot) => bot.account_status === 'connected').length,
    adopted,
    feedAt: feedAt ? new Date(feedAt).toISOString() : '',
    feedStale,
  };

  const status = tableDown ? 'degraded' : issues.length ? 'attention' : 'healthy';
  const parts = [
    `${roster.running} of ${roster.total} bots running`,
    trimmed.sessions ? `${trimmed.sessions} expired session${trimmed.sessions === 1 ? '' : 's'} cleared` : '',
    trimmed.attempts ? `${trimmed.attempts} stale lockout${trimmed.attempts === 1 ? '' : 's'} cleared` : '',
    seeded ? `swarm seeded with ${seeded} bots` : '',
    issues.length ? issues.join(' ') : 'no issues',
  ].filter(Boolean);
  const note = `Maintenance pass: ${parts.join(', ')}.`.replace(/\.\./g, '.');

  // 5. Stamp + log, rate limited
  let skipped = false;
  try {
    const last = rows(await store.FoundryEvent.filter({ kind: 'maintenance' }, '-created_date', 1))[0];
    const lastAt = last ? Date.parse(last.created_at || last.created_date) : 0;
    skipped = Boolean(lastAt && Date.now() - lastAt < MIN_GAP_MS && !seeded && !trimmed.sessions && !trimmed.attempts);
    if (!skipped) {
      const chief = bots.find((bot) => bot.slug === 'maintenance');
      if (chief) {
        await store.FoundryBot.update(chief.id, {
          last_run: at,
          last_result: note.slice(0, 240),
          last_action: status === 'healthy' ? 'Health check passed.' : 'Health check flagged items for you.',
        });
      }
      await store.FoundryEvent.create({ kind: 'maintenance', message: note, bot_slug: 'maintenance', created_at: at });
    }
  } catch (problem) {
    console.warn('maintenance log', String(problem));
  }

  return json(req, { ok: !tableDown, status, at, skipped, tables, trimmed, seeded, roster, issues, note });
}
