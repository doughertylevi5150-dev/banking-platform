import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * operatorAI — the Operator. Reads the live foundry (bots, money, funding,
 * activity) and answers with grounded specifics. It can act through a small
 * allowlist, and only when the console sends an approved action back.
 *
 * Actions: brief (no model, always works) · ask (model-backed) · apply (allowlisted act)
 * No model is 100% right, so every number in an answer comes from the database
 * on that request, and the model is told to say "I don't know" instead of guessing.
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

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const at = (row: any) => row?.created_at || row?.created_date || '';

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function snapshot(store: any) {
  const [bots, funding, events, proposals] = await Promise.all([
    store.FoundryBot.list('-created_date', 400).then(rows),
    store.FoundryFunding.list('-created_date', 60).then(rows),
    store.FoundryEvent.list('-created_date', 120).then(rows),
    store.FoundryProposal.list('-created_date', 60).then(rows),
  ]);

  const running = bots.filter((b: any) => b.status === 'running');
  const stopped = bots.filter((b: any) => b.status !== 'running');
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const money = { earning: 0, expense: 0 };
  for (const event of events) {
    if (Date.parse(at(event)) < weekAgo) continue;
    if (event.kind === 'earning') money.earning += num(event.amount);
    if (event.kind === 'expense') money.expense += num(event.amount);
  }

  const byClass: Record<string, number> = {};
  for (const bot of bots) byClass[bot.class_label || 'Unlabelled'] = (byClass[bot.class_label || 'Unlabelled'] || 0) + 1;

  const open = funding.filter((f: any) => (f.status || 'approved') !== 'closed');
  const trim = (f: any) => ({
    route: f.route,
    title: f.title,
    kind: f.kind,
    amount: num(f.est_amount),
    notes: String(f.notes || '').slice(0, 220),
  });

  return {
    generated_at: new Date().toISOString(),
    bots: {
      total: bots.length,
      running: running.length,
      not_running: stopped.length,
      stopped: stopped.slice(0, 12).map((b: any) => ({ slug: b.slug, name: b.name, status: b.status })),
      by_class: byClass,
      needing_accounts: bots
        .filter((b: any) => b.account_needs && !b.account_provider)
        .slice(0, 12)
        .map((b: any) => ({ slug: b.slug, name: b.name, needs: b.account_needs })),
    },
    money_last_7_days: { earning: r2(money.earning), expense: r2(money.expense), net: r2(money.earning - money.expense) },
    funding: {
      count: open.length,
      money_routes: open.filter((f: any) => ['loan', 'credit', 'equity'].includes(f.kind)).map(trim),
      grant_routes: open.filter((f: any) => ['grant', 'credits'].includes(f.kind)).map(trim),
    },
    proposals_waiting: proposals.filter((p: any) => p.status === 'pending').length,
    recent_events: events.slice(0, 14).map((e: any) => ({
      at: at(e),
      kind: e.kind,
      bot: e.bot_slug || '',
      message: String(e.message || '').slice(0, 240),
    })),
  };
}

function briefText(snap: any) {
  const lines: string[] = [];
  const money = snap.money_last_7_days;
  lines.push(`${snap.bots.running} of ${snap.bots.total} bots are running${snap.bots.not_running ? `, ${snap.bots.not_running} are not` : ''}.`);
  lines.push(`Last 7 days: $${money.earning.toFixed(2)} earned, $${money.expense.toFixed(2)} spent, net $${money.net.toFixed(2)}.`);
  const top = snap.funding.money_routes.slice(0, 3).map((r: any) => `${r.title} ($${Math.round(r.amount).toLocaleString()})`);
  if (top.length) lines.push(`Live capital routes: ${top.join(', ')}.`);
  if (snap.proposals_waiting) lines.push(`${snap.proposals_waiting} bot proposals are waiting on your decision.`);
  const last = snap.recent_events[0];
  if (last) lines.push(`Most recent activity: ${last.message}`);
  return lines.join('\n');
}

function fallbackAnswer(question: string, snap: any) {
  const q = question.toLowerCase();
  const money = snap.money_last_7_days;

  if (/(fund|loan|grant|capital|lender|cash)/.test(q)) {
    const list = [...snap.funding.money_routes, ...snap.funding.grant_routes];
    if (!list.length) return 'No funding routes are open right now.';
    return 'Open capital routes:\n' + list
      .slice(0, 6)
      .map((r: any) => `- ${r.title} — $${Math.round(r.amount).toLocaleString()} (${r.kind})${r.notes ? `: ${r.notes}` : ''}`)
      .join('\n');
  }
  if (/(bot|swarm|status|health|running|pause)/.test(q)) {
    const stopped = snap.bots.stopped.map((b: any) => `${b.name} (${b.status})`).join(', ');
    const needs = snap.bots.needing_accounts.map((b: any) => b.name).join(', ');
    return `${snap.bots.running} of ${snap.bots.total} bots are running.${stopped ? `\nNot running: ${stopped}.` : ''}${needs ? `\nWaiting on accounts: ${needs}.` : ''}`;
  }
  if (/(money|revenue|earn|profit|spend|burn)/.test(q)) {
    return `Last 7 days: $${money.earning.toFixed(2)} earned, $${money.expense.toFixed(2)} spent, net $${money.net.toFixed(2)}.`;
  }
  if (/(next|should|do now|priority|focus)/.test(q)) {
    const picks: string[] = [];
    if (snap.proposals_waiting) picks.push(`Decide ${snap.proposals_waiting} waiting proposals in the foundry.`);
    if (snap.bots.not_running) picks.push(`Restart ${snap.bots.not_running} bots that are not running.`);
    if (snap.funding.money_routes.length) picks.push(`Push ${snap.funding.money_routes[0].title}, the closest money route.`);
    if (money.net <= 0) picks.push('Record real earnings, or the swarm cannot prove a number.');
    if (!picks.length) picks.push('Everything is running. Give the Think Bot a target and let it draft.');
    return picks.map((p, i) => `${i + 1}. ${p}`).join('\n');
  }
  return briefText(snap);
}

const SYSTEM = `You are the Operator inside LevisBotUniverse, the owner's console.
You are direct, concrete and short. Never invent numbers, bot names, routes or dates: everything
you state must come from the STATE block. If the state does not cover it, say "I don't have that
in the console yet" and name the desk where it would live (foundry, funding, treasury, activity).
The owner is Levi. The business runs a swarm of narrow autonomous bots, each with one job, and he
approves anything that spends money. The console is pre-revenue and chasing startup capital.
Answer in plain text with simple hyphens, no markdown headers.
If the state implies a concrete action the console can perform, add it to actions.
Allowed action types only: toggleBot (payload.slug), recordMoney (payload.botSlug, payload.kind
earning|expense, payload.amount, payload.note), logNote (payload.message), setFundingNote
(payload.route, payload.note), draftProposal (payload.title, payload.class_label, payload.charter,
payload.revenue_model, payload.risk_level, payload.est_monthly).
Never propose more than three actions and never propose an action that spends money.`;

async function askModel(base44: any, question: string, history: any[], snap: any) {
  const turns = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((turn: any) => `${turn.role === 'owner' ? 'Levi' : 'Operator'}: ${String(turn.text || '').slice(0, 600)}`)
    .join('\n');

  const prompt = `${SYSTEM}

STATE (live, read from the database on this request):
${JSON.stringify(snap, null, 1)}
${turns ? `\nCONVERSATION SO FAR:\n${turns}\n` : ''}
Levi asks: ${question}

Reply as JSON:
{"reply": "the answer, plain text", "actions": [{"type": "...", "label": "short imperative label", "payload": {}}], "followups": ["a short next question Levi might ask"]}
Use an empty actions array when no action is warranted.`;

  // The service client is the one that can reach the model from a function; the
  // request client refuses when the caller is the console's own session token.
  const candidates: Array<[string, any]> = [
    ['service.integrations.Core.InvokeLLM', base44?.asServiceRole?.integrations?.Core?.InvokeLLM],
    ['request.integrations.Core.InvokeLLM', base44?.integrations?.Core?.InvokeLLM],
  ];
  const named = candidates.find(([, fn]) => typeof fn === 'function');
  if (!named) {
    throw new Error(
      'no-llm ' +
        JSON.stringify({
          keys: Object.keys(base44 || {}),
          integrations: Boolean(base44?.integrations),
          core: Boolean(base44?.integrations?.Core),
          serviceRole: Boolean(base44?.asServiceRole),
        }),
    );
  }
  const [via, llm] = named;
  console.log('operatorAI using', via);

  const raw = await llm({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        reply: { type: 'string' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, label: { type: 'string' }, payload: { type: 'object' } },
          },
        },
        followups: { type: 'array', items: { type: 'string' } },
      },
    },
  });

  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return {
    reply: String(parsed?.reply || '').trim(),
    actions: Array.isArray(parsed?.actions) ? parsed.actions.slice(0, 3) : [],
    followups: Array.isArray(parsed?.followups) ? parsed.followups.slice(0, 3) : [],
  };
}

const ALLOWED = new Set(['toggleBot', 'recordMoney', 'logNote', 'setFundingNote', 'draftProposal']);

async function applyAction(store: any, action: any) {
  const type = String(action?.type || '');
  if (!ALLOWED.has(type)) return { ok: false, error: `"${type}" is not an action the Operator may run.` };
  const p = action.payload || {};
  const now = new Date().toISOString();

  if (type === 'toggleBot') {
    const bot = rows(await store.FoundryBot.filter({ slug: String(p.slug || '') }, undefined, 1))[0];
    if (!bot) return { ok: false, error: 'No bot with that slug.' };
    const next = bot.status === 'running' ? 'paused' : 'running';
    await store.FoundryBot.update(bot.id, { status: next });
    await store.FoundryEvent.create({
      kind: 'operator',
      message: `Operator set ${bot.name} to ${next}.`,
      bot_slug: bot.slug,
      created_at: now,
    });
    return { ok: true, done: `${bot.name} is now ${next}.` };
  }

  if (type === 'recordMoney') {
    const amount = num(p.amount);
    const kind = p.kind === 'expense' ? 'expense' : 'earning';
    if (!amount) return { ok: false, error: 'Amount must be greater than zero.' };
    await store.FoundryEvent.create({
      kind,
      message: `${p.note || 'Recorded by the Operator'}: $${amount.toFixed(2)} ${kind}.`,
      bot_slug: String(p.botSlug || 'operator'),
      created_at: now,
    });
    return { ok: true, done: `Recorded $${amount.toFixed(2)} as ${kind}.` };
  }

  if (type === 'logNote') {
    const message = String(p.message || '').slice(0, 400);
    if (!message) return { ok: false, error: 'Nothing to log.' };
    await store.FoundryEvent.create({ kind: 'operator', message, bot_slug: 'operator', created_at: now });
    return { ok: true, done: 'Logged to activity.' };
  }

  if (type === 'setFundingNote') {
    const route = rows(await store.FoundryFunding.filter({ route: String(p.route || '') }, undefined, 1))[0];
    if (!route) return { ok: false, error: 'No funding route with that slug.' };
    await store.FoundryFunding.update(route.id, { notes: String(p.note || '').slice(0, 900) });
    return { ok: true, done: `Updated the note on ${route.title}.` };
  }

  if (type === 'draftProposal') {
    const title = String(p.title || '').slice(0, 120);
    if (!title) return { ok: false, error: 'A proposal needs a title.' };
    await store.FoundryProposal.create({
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40),
      class_label: String(p.class_label || 'Ideas').slice(0, 40),
      charter: String(p.charter || '').slice(0, 900),
      revenue_model: String(p.revenue_model || '').slice(0, 240),
      risk_level: String(p.risk_level || 'moderate').slice(0, 20),
      est_monthly: num(p.est_monthly),
      status: 'pending',
      source: 'operator',
    });
    return { ok: true, done: `Queued "${title}" for your approval.` };
  }

  return { ok: false, error: 'Unhandled action.' };
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('operatorAI failure', error);
    return json(req, { error: 'The Operator hit a problem. Try again in a moment.' }, 500);
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

  const [scheme, token] = (req.headers.get('authorization') || '').split(' ');
  let owner: any = null;
  if (token && scheme.toLowerCase() === 'bearer') {
    const session = rows(await store.BankingSession.filter({ token_hash: await sha256(token) }, undefined, 1))[0];
    if (session && Date.parse(session.expires_at) > Date.now()) {
      owner = rows(await store.BankingOwner.filter({ email: session.owner_email }, undefined, 1))[0] || null;
    }
  }
  if (!owner) return json(req, { error: LOCKED }, 401);

  const action = String(body.action || 'brief');
  const snap = await snapshot(store);

  if (action === 'brief') return json(req, { mode: 'brief', snapshot: snap, reply: briefText(snap) });

  if (action === 'apply') {
    const result = await applyAction(store, body.input || {});
    return json(req, result, result.ok ? 200 : 400);
  }

  if (action === 'ask') {
    const question = String(body.message || '').trim().slice(0, 1200);
    if (!question) return json(req, { error: 'Ask something and the Operator will answer.' }, 400);

    let mode = 'model';
    let answer: any;
    try {
      answer = await askModel(base44, question, body.history, snap);
      if (!answer.reply) throw new Error('empty-reply');
    } catch (error) {
      console.warn('operatorAI model unavailable', String(error));
      mode = 'offline';
      answer = {
        reply: fallbackAnswer(question, snap),
        actions: [],
        followups: [],
        model_error: String(error).slice(0, 300),
      };
    }

    await store.FoundryEvent.create({
      kind: 'operator',
      message: `Operator answered: "${question.slice(0, 160)}" (${mode}).`,
      bot_slug: 'operator',
      created_at: new Date().toISOString(),
    });

    return json(req, { mode, ...answer, snapshot: snap });
  }

  return json(req, { error: 'Unknown action.' }, 400);
}
