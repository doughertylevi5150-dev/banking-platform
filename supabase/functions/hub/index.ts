/**
 * hub: the owner-only Control Hub API. Every action needs the console session
 * that bankingAuth issues (x-console-token).
 *
 * POST { action, ... }
 *   list                         -> bots (no prompt bodies) + counts
 *   setStatus { slug, status }   -> off | test | live
 *   runs { bot?, flagged?, limit? }
 *   thumbs { id, value }         -> 1 | -1 | 0 (clear). Thumbs-down flags the run for the Evolver.
 *   approvals { status? }        -> pending (default) | approved | rejected | all
 *   decide { id, decision }      -> approve | reject
 *
 * HARD RULE: deciding an approval only records Levi's decision. Nothing in this
 * build spends money, buys, sells, or signs anything.
 */
import { cors, db, geminiKey, json, ownerFrom } from '../_shared/hub.ts';

const STATUSES = new Set(['off', 'test', 'live']);
const PUBLIC_DEMO = new Set(['missedcall-bot']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  try {
    const owner = await ownerFrom(req);
    if (!owner) return json(req, { error: 'Sign in to the console first.' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'list');

    if (action === 'list') {
      const { data: bots, error } = await db()
        .from('bots')
        .select('slug,name,one_task,version,score,status,updated_at')
        .order('name');
      if (error) throw error;
      const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data: recent } = await db().from('bot_runs').select('bot,thumbs').gte('created_at', since).limit(5000);
      const stats: Record<string, { runs: number; up: number; down: number }> = {};
      for (const r of recent || []) {
        const s = (stats[r.bot] ||= { runs: 0, up: 0, down: 0 });
        s.runs += 1;
        if (r.thumbs === 1) s.up += 1;
        if (r.thumbs === -1) s.down += 1;
      }
      const { count: pending } = await db().from('approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      const { count: flagged } = await db().from('bot_runs').select('id', { count: 'exact', head: true }).eq('flagged', true);
      return json(req, {
        bots: (bots || []).map((b) => ({ ...b, publicDemo: PUBLIC_DEMO.has(b.slug), week: stats[b.slug] || { runs: 0, up: 0, down: 0 } })),
        pendingApprovals: pending || 0,
        flaggedRuns: flagged || 0,
        aiConnected: Boolean(await geminiKey()),
      });
    }

    if (action === 'setStatus') {
      const slug = String(body?.slug || '');
      const status = String(body?.status || '');
      if (!STATUSES.has(status)) return json(req, { error: 'Status must be off, test or live.' }, 400);
      const { data, error } = await db()
        .from('bots')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('slug', slug)
        .select('slug,name,status')
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(req, { error: 'No bot by that name.' }, 404);
      return json(req, { bot: data });
    }

    if (action === 'runs') {
      const limit = Math.min(Math.max(Number(body?.limit) || 30, 1), 100);
      let q = db()
        .from('bot_runs')
        .select('id,bot,input,output,created_at,thumbs,flagged,source,model')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (body?.bot) q = q.eq('bot', String(body.bot));
      if (body?.flagged) q = q.eq('flagged', true);
      const { data, error } = await q;
      if (error) throw error;
      return json(req, { runs: data || [] });
    }

    if (action === 'thumbs') {
      const id = String(body?.id || '');
      const value = Number(body?.value);
      const thumbs = value === 1 ? 1 : value === -1 ? -1 : null;
      const { data, error } = await db()
        .from('bot_runs')
        .update({ thumbs, flagged: thumbs === -1 })
        .eq('id', id)
        .select('id,thumbs,flagged')
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(req, { error: 'Run not found.' }, 404);
      return json(req, { run: data });
    }

    if (action === 'approvals') {
      const status = String(body?.status || 'pending');
      let q = db()
        .from('approvals')
        .select('id,bot,kind,summary,amount,status,created_at,decided_at,run_id')
        .order('created_at', { ascending: false })
        .limit(100);
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return json(req, { approvals: data || [] });
    }

    if (action === 'decide') {
      const id = String(body?.id || '');
      const decision = String(body?.decision || '');
      if (decision !== 'approve' && decision !== 'reject') return json(req, { error: 'Approve or reject.' }, 400);
      const { data, error } = await db()
        .from('approvals')
        .update({ status: decision === 'approve' ? 'approved' : 'rejected', decided_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id,bot,kind,summary,amount,status,decided_at')
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(req, { error: 'That approval is gone or already decided.' }, 409);
      // Recording the decision is all that happens. No money moves in this build.
      return json(req, { approval: data, executed: false, note: 'Decision recorded. Nothing was bought, sold or paid.' });
    }

    if (action === 'setAiKey') {
      // The key arrives in a header (never in the page or the logs), is checked
      // against Google, then stored encrypted in Supabase Vault.
      const key = String(req.headers.get('x-goog-api-key') || body?.key || '').trim();
      if (!key || key.length > 200) return json(req, { error: 'Paste the Gemini API key first.' }, 400);
      const check = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        headers: { 'x-goog-api-key': key },
      });
      if (!check.ok) return json(req, { error: `Google refused that key (HTTP ${check.status}).` }, 400);
      const { error } = await db().rpc('set_gemini_key', { k: key });
      if (error) throw error;
      return json(req, { connected: true });
    }

    return json(req, { error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('hub failed', error);
    return json(req, { error: 'The hub could not finish that.' }, 500);
  }
});
