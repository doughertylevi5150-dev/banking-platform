/**
 * Shared pieces for the Control Hub functions (bot-run, hub).
 * Service-role client, CORS, and the owner check that reuses the console's
 * own session (banking_session token hash -> banking_owner), exactly like
 * bankingAuth issues it.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function cors(req: Request) {
  return {
    'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info, x-console-token, x-goog-api-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The console session token: x-console-token, or Authorization: Bearer (older clients). */
export function consoleToken(req: Request) {
  const custom = (req.headers.get('x-console-token') || '').trim();
  if (custom) return custom;
  const [scheme, token] = (req.headers.get('authorization') || '').split(' ');
  return token && scheme.toLowerCase() === 'bearer' ? token.trim() : '';
}

/** Returns the owner row for a live console session, or null. */
export async function ownerFrom(req: Request) {
  const token = consoleToken(req);
  if (!token || token.length < 20) return null;
  const { data: session } = await db()
    .from('banking_session')
    .select('owner_email, expires_at')
    .eq('token_hash', await sha256(token))
    .limit(1)
    .maybeSingle();
  if (!session || !(Date.parse(session.expires_at) > Date.now())) return null;
  const { data: owner } = await db()
    .from('banking_owner')
    .select('email, name')
    .eq('email', session.owner_email)
    .limit(1)
    .maybeSingle();
  return owner || null;
}

/** Salted hash of the caller's IP: enough to rate-limit, never stored raw. */
export async function clientHash(req: Request) {
  const ip =
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const salt = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'salt').slice(-24);
  return (await sha256(`${salt}:${ip}`)).slice(0, 32);
}

let cachedKey = '';
let cachedAt = 0;

/** Gemini key: function secret GEMINI_API_KEY, else the Vault entry the hub can set. */
export async function geminiKey() {
  const env = Deno.env.get('GEMINI_API_KEY') || '';
  if (env) return env;
  if (cachedKey && Date.now() - cachedAt < 5 * 60_000) return cachedKey;
  const { data } = await db().rpc('get_gemini_key');
  cachedKey = typeof data === 'string' ? data : '';
  cachedAt = Date.now();
  return cachedKey;
}
