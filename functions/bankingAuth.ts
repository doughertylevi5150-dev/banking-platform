import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOCKED = 'This console is limited to its owner.';
// The hosted runtime rejects PBKDF2 above 100k iterations, so that is the ceiling.
const MAX_ITERATIONS = 100_000;
const ITERATIONS = 100_000;
const SESSION_DAYS = 7;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const cors = (req: Request) => ({
  'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '600',
  'Content-Type': 'application/json',
});

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}

function rows(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(key))}`;
}

async function deriveKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, 256);
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !saltB64 || !hashB64) return false;

  const salt = fromB64(saltB64);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const rounds = Math.min(Number(iterations) || ITERATIONS, MAX_ITERATIONS);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, material, 256),
  );
  const expected = fromB64(hashB64);

  let diff = bits.length ^ expected.length;
  for (let i = 0; i < bits.length; i += 1) diff |= bits[i] ^ (expected[i] ?? 0);
  return diff === 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function publicUser(owner: any) {
  return { email: owner.email, name: owner.name, role: owner.role || 'owner', createdAt: owner.created_at };
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('bankingAuth failure', error);
    return json(req, { error: 'The sign-in service hit a problem. Try again in a moment.' }, 500);
  }
});

async function handle(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  const base44 = createClientFromRequest(req);
  const store = base44.asServiceRole.entities as any;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = String(body.action || 'status');
  const setupKey = Deno.env.get('OWNER_SETUP_KEY') || '';

  async function findOwner(email?: string) {
    const result = email
      ? await store.BankingOwner.filter({ email: String(email).toLowerCase() }, undefined, 5)
      : await store.BankingOwner.list(undefined, 5);
    const list = rows(result);
    if (email) return list.find((row: any) => String(row.email).toLowerCase() === String(email).toLowerCase()) || null;
    return list.find((row: any) => (row.role || 'owner') === 'owner') || null;
  }

  async function startSession(owner: any) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await store.BankingSession.create({
      token_hash: await sha256(token),
      owner_email: owner.email,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });
    return { token, expiresAt, user: publicUser(owner) };
  }

  async function caller() {
    const header = req.headers.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (!token || scheme.toLowerCase() !== 'bearer') return null;

    const hash = await sha256(token);
    const found = rows(await store.BankingSession.filter({ token_hash: hash }, undefined, 1))[0];
    if (!found) return null;
    if (Date.parse(found.expires_at) <= Date.now()) {
      await store.BankingSession.delete(found.id);
      return null;
    }

    const owner = await findOwner(found.owner_email);
    if (!owner) return null;
    return { owner, session: found };
  }

  async function attemptsFor(email: string) {
    const found = rows(await store.BankingAttempt.filter({ key: email }, undefined, 1))[0];
    if (!found) return { record: null, blocked: false };
    const fresh = Date.parse(found.window_start) + ATTEMPT_WINDOW_MS > Date.now();
    if (!fresh) return { record: found, blocked: false, stale: true };
    return {
      record: found,
      blocked: Number(found.count) >= MAX_ATTEMPTS,
      retryAfterSeconds: Math.ceil((Date.parse(found.window_start) + ATTEMPT_WINDOW_MS - Date.now()) / 1000),
    };
  }

  async function recordFailure(email: string) {
    const state = await attemptsFor(email);
    if (state.stale) {
      await store.BankingAttempt.update(state.record.id, { count: 1, window_start: new Date().toISOString() });
      return;
    }
    if (state.record) {
      await store.BankingAttempt.update(state.record.id, { count: Number(state.record.count) + 1 });
      return;
    }
    await store.BankingAttempt.create({ key: email, count: 1, window_start: new Date().toISOString() });
  }

  if (action === 'status') {
    const owner = await findOwner();
    return json(req, { setupRequired: !owner, setupConfigured: Boolean(setupKey) });
  }

  if (action === 'setup') {
    if (await findOwner()) return json(req, { error: LOCKED }, 403);
    if (!setupKey || body.setupKey !== setupKey) return json(req, { error: 'That setup key is not valid.' }, 403);

    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const fields: Record<string, string> = {};

    if (!name) fields.name = 'Enter your name.';
    if (!email) fields.email = 'Enter your email address.';
    else if (!EMAIL_PATTERN.test(email)) fields.email = 'That email address looks incomplete.';
    if (!password) fields.password = 'Enter your password.';
    else if (password.length < 8) fields.password = 'Passwords are at least 8 characters.';
    if (Object.keys(fields).length) return json(req, { error: 'Check the highlighted fields.', fields }, 400);

    const owner = await store.BankingOwner.create({
      email,
      name,
      role: 'owner',
      password_hash: await hashPassword(password),
      created_at: new Date().toISOString(),
    });

    return json(req, await startSession(owner), 201);
  }

  if (action === 'login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
      return json(req, { error: 'Check the highlighted fields.', fields: { email: 'Enter your email address.' } }, 400);
    }

    const gate = await attemptsFor(email);
    if (gate.blocked) {
      return json(
        req,
        { error: `Too many attempts. Try again in ${Math.ceil((gate.retryAfterSeconds || 60) / 60)} minutes.` },
        429,
      );
    }

    const owner = await findOwner(email);
    const matches = owner ? await verifyPassword(password, owner.password_hash) : false;

    if (!owner || !matches) {
      await recordFailure(email);
      return json(req, { error: 'Email or password is incorrect.' }, 401);
    }

    if ((owner.role || 'owner') !== 'owner') return json(req, { error: LOCKED }, 403);

    const attempt = rows(await store.BankingAttempt.filter({ key: email }, undefined, 1))[0];
    if (attempt) await store.BankingAttempt.delete(attempt.id);

    return json(req, await startSession(owner));
  }

  if (action === 'me') {
    const auth = await caller();
    if (!auth) return json(req, { error: 'Your session has expired. Sign in again.' }, 401);
    return json(req, { user: publicUser(auth.owner), expiresAt: auth.session.expires_at });
  }

  if (action === 'logout') {
    const auth = await caller();
    if (auth) await store.BankingSession.delete(auth.session.id);
    return new Response(null, { status: 204, headers: cors(req) });
  }

  return json(req, { error: 'Unknown action.' }, 400);
}
