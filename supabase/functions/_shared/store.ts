/**
 * Drop-in replacement for `base44.asServiceRole.entities`.
 *
 * Each Base44 entity maps to one Postgres table (BankingOwner -> banking_owner)
 * and exposes the same calls the functions already make:
 *
 *   list(sort?, limit?, skip?)
 *   filter(query, sort?, limit?, skip?)
 *   get(id)
 *   create(data)      -> the inserted row
 *   update(id, data)  -> the updated row
 *   delete(id)
 *
 * `sort` keeps Base44's format: 'field' ascending, '-field' descending.
 * Every call uses the service role key, so RLS (enabled, no policies) blocks
 * anon/public access while the functions read and write freely.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (client) return client;
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** BankingOwner -> banking_owner, PlaidItem -> plaid_item */
export function tableName(entity: string) {
  return entity
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

type Row = Record<string, any>;

function fail(op: string, table: string, error: { message?: string; code?: string } | null) {
  if (error) throw new Error(`${table}.${op} failed: ${error.code || ''} ${error.message || ''}`.trim());
}

function applySort(query: any, sort?: string) {
  if (!sort) return query;
  const desc = sort.startsWith('-');
  const column = desc ? sort.slice(1) : sort.replace(/^\+/, '');
  return query.order(column, { ascending: !desc, nullsFirst: false });
}

function applyPage(query: any, limit?: number, skip?: number) {
  const size = Number(limit) > 0 ? Number(limit) : 1000;
  const from = Math.max(Number(skip) || 0, 0);
  return query.range(from, from + size - 1);
}

/** Base44 ids were opaque strings; ours are uuids. A non-uuid id simply matches nothing. */
function impossibleId(query: Row) {
  return 'id' in query && query.id != null && !UUID.test(String(query.id));
}

function entity(name: string) {
  const table = tableName(name);

  return {
    async list(sort?: string, limit?: number, skip?: number): Promise<Row[]> {
      const { data, error } = await applyPage(applySort(db().from(table).select('*'), sort), limit, skip);
      fail('list', table, error);
      return data || [];
    },

    async filter(query: Row = {}, sort?: string, limit?: number, skip?: number): Promise<Row[]> {
      if (impossibleId(query)) return [];
      let q: any = db().from(table).select('*');
      for (const [column, value] of Object.entries(query || {})) {
        if (value === undefined) continue;
        if (value === null) q = q.is(column, null);
        else if (Array.isArray(value)) q = q.in(column, value);
        else if (typeof value === 'object') q = q.contains(column, value);
        else q = q.eq(column, value);
      }
      const { data, error } = await applyPage(applySort(q, sort), limit, skip);
      fail('filter', table, error);
      return data || [];
    },

    async get(id: string): Promise<Row | null> {
      if (!UUID.test(String(id))) return null;
      const { data, error } = await db().from(table).select('*').eq('id', id).maybeSingle();
      fail('get', table, error);
      return data || null;
    },

    async create(record: Row): Promise<Row> {
      const { id: _drop, created_date: _c, updated_date: _u, ...clean } = record || {};
      const { data, error } = await db().from(table).insert(clean).select('*').single();
      fail('create', table, error);
      return data;
    },

    async update(id: string, changes: Row): Promise<Row | null> {
      if (!UUID.test(String(id))) return null;
      const { id: _drop, created_date: _c, ...clean } = changes || {};
      const { data, error } = await db()
        .from(table)
        .update({ ...clean, updated_date: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      fail('update', table, error);
      return data || null;
    },

    async delete(id: string): Promise<void> {
      if (!UUID.test(String(id))) return;
      const { error } = await db().from(table).delete().eq('id', id);
      fail('delete', table, error);
    },
  };
}

export type Entity = ReturnType<typeof entity>;

const cache = new Map<string, Entity>();

/** `store.BankingOwner.filter(...)`, same as `base44.asServiceRole.entities.BankingOwner.filter(...)`. */
export const store: Record<string, Entity> = new Proxy({} as Record<string, Entity>, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    if (!cache.has(prop)) cache.set(prop, entity(prop));
    return cache.get(prop);
  },
});

/* ------------------------------------------------------------------ */
/* Shared request helpers                                              */
/* ------------------------------------------------------------------ */

export const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, apikey, x-client-info, x-console-token';

/**
 * The console's session token. The client sends it in `x-console-token` (so the
 * Supabase anon key can ride in Authorization); older clients and the local
 * Express dev server still use `Authorization: Bearer <token>`.
 */
export function consoleToken(req: Request) {
  const custom = (req.headers.get('x-console-token') || '').trim();
  if (custom) return custom;
  const [scheme, token] = (req.headers.get('authorization') || '').split(' ');
  return token && scheme.toLowerCase() === 'bearer' ? token.trim() : '';
}
