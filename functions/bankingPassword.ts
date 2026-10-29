import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * Changes the owner's password from inside the console.
 *
 * Kept separate from bankingAuth so the sign-in function stays untouched. It
 * validates the session token and the current password before writing a new
 * PBKDF2 hash, then signs out every other device.
 */

const ITERATIONS = 100_000;
const MIN_LENGTH = 8;

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
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, 256);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, , saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !saltB64 || !hashB64) return false;

  const salt = fromB64(saltB64);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, 256),
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  try {
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
    const bearer = token && scheme.toLowerCase() === 'bearer' ? token : String(body.token || '');
    if (!bearer) return json(req, { error: 'Your session has expired. Sign in again.' }, 401);

    const session = rows(await store.BankingSession.filter({ token_hash: await sha256(bearer) }, undefined, 1))[0];
    if (!session || Date.parse(session.expires_at) <= Date.now()) {
      if (session) await store.BankingSession.delete(session.id);
      return json(req, { error: 'Your session has expired. Sign in again.' }, 401);
    }

    const owner = rows(await store.BankingOwner.filter({ email: session.owner_email }, undefined, 1))[0];
    if (!owner) return json(req, { error: 'Your session has expired. Sign in again.' }, 401);

    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const fields: Record<string, string> = {};

    if (!currentPassword) fields.currentPassword = 'Enter your current password.';
    if (!newPassword) fields.newPassword = 'Enter a new password.';
    else if (newPassword.length < MIN_LENGTH) fields.newPassword = 'Passwords are at least 8 characters.';
    if (Object.keys(fields).length) return json(req, { error: 'Check the highlighted fields.', fields }, 400);

    if (!(await verifyPassword(currentPassword, owner.password_hash))) {
      return json(req, { error: 'That current password is not right.' }, 401);
    }

    await store.BankingOwner.update(owner.id, { password_hash: await hashPassword(newPassword) });

    // A new password signs out every other device; this session keeps working.
    const sessions = rows(await store.BankingSession.filter({ owner_email: owner.email }, undefined, 50));
    for (const other of sessions) {
      if (other.id !== session.id) await store.BankingSession.delete(other.id);
    }

    return json(req, { ok: true });
  } catch (error) {
    console.error('bankingPassword failure', error);
    return json(req, { error: 'The password change hit a problem. Try again in a moment.' }, 500);
  }
});
