import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * plaidApi — the Plaid bridge for the LevisBotUniverse console and its bots.
 *
 * Actions (POST body {action, ...}):
 *   health     {env?}  — proves the client_id/secret pair works
 *   link_token {env?, user_id?, products?} — mints a Plaid Link token for the browser
 *   exchange   {public_token, env?, institution_name?} — swaps a Link token for an access
 *              token, reads the accounts, and stores the item in the PlaidItem entity
 *   accounts   {item_id?, env?} — lists linked accounts (and balances when asked)
 *
 * Auth: an admin console session, or `Authorization: Bearer $BASE44_SERVICE_TOKEN`
 * for server-to-server calls from the swarm bots.
 */

const HOSTS = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

function readEnv(name) {
  try {
    if (typeof Deno !== 'undefined' && Deno.env?.get) return String(Deno.env.get(name) || '').trim();
  } catch {
    /* ignore */
  }
  try {
    if (typeof process !== 'undefined' && process.env?.[name]) return String(process.env[name]).trim();
  } catch {
    /* ignore */
  }
  return '';
}

const isEnvName = (value) => value === 'sandbox' || value === 'production';

const rows = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}


/**
 * Secret names have drifted once already (a sandbox secret landed in PLAID_ENV),
 * so build a candidate list per environment and let Plaid reject the wrong ones.
 */
function plaidConfig(requestedEnv) {
  const clientId = readEnv('PLAID_CLIENT_ID');
  const slot = readEnv('PLAID_ENV');
  const slotIsEnvName = isEnvName(slot.toLowerCase());

  const wanted = String(requestedEnv || '').toLowerCase();
  const envName = isEnvName(wanted) ? wanted : slotIsEnvName ? slot.toLowerCase() : 'sandbox';

  const stray = slotIsEnvName ? '' : slot; // a secret parked in the env slot
  const secrets =
    envName === 'production'
      ? [readEnv('PLAID_PRODUCTION_SECRET'), readEnv('PLAID_SECRET'), stray]
      : [readEnv('PLAID_SANDBOX_SECRET'), stray, readEnv('PLAID_SECRET')];

  return { clientId, envName, host: HOSTS[envName], secrets: secrets.filter(Boolean) };
}

async function plaidPost(path, body, config) {
  if (!config.clientId || !config.secrets.length) {
    return { ok: false, status: 400, data: { error_code: 'MISSING_CREDENTIALS' } };
  }
  let lastError = null;
  for (const secret of config.secrets) {
    const res = await fetch(`${config.host}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, secret, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error_code === 'INVALID_API_KEYS') {
      lastError = data;
      continue;
    }
    return { ok: res.ok && !data.error_code, status: res.status, data };
  }
  return { ok: false, status: 400, data: lastError || { error_code: 'INVALID_API_KEYS' } };
}

/**
 * Two ways in: the owner's console session (same banking token the foundry desk
 * uses) or `Authorization: Bearer $BASE44_SERVICE_TOKEN` for the bots.
 */
async function authorize(req) {
  const header = req.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  const bearer = token && String(scheme).toLowerCase() === 'bearer' ? token.trim() : '';
  const serviceToken = readEnv('BASE44_SERVICE_TOKEN');
  if (bearer && serviceToken && bearer === serviceToken) return { ok: true, role: 'service', user: null };

  const base44 = createClientFromRequest(req);
  const store = base44.asServiceRole.entities as any;

  if (bearer) {
    try {
      const session = rows(await store.BankingSession.filter({ token_hash: await sha256(bearer) }, undefined, 1))[0];
      if (session && Date.parse(session.expires_at) > Date.now()) {
        const owner = rows(await store.BankingOwner.filter({ email: session.owner_email }, undefined, 1))[0];
        if (owner) return { ok: true, role: 'owner', user: owner, base44 };
      }
    } catch {
      /* fall through to the admin check */
    }
  }

  try {
    const user = await base44.auth.me();
    if (user?.role === 'admin') return { ok: true, role: 'admin', user, base44 };
  } catch {
    /* not signed in */
  }
  return { ok: false };
}

export default async function (req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const auth = await authorize(req);
    if (!auth.ok) return json({ error: 'Not authorized.' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'health').toLowerCase();
    const config = plaidConfig(body?.env);

    if (!config.clientId) {
      return json({ error: 'PLAID_CLIENT_ID is not set for this app.' }, 400);
    }

    if (action === 'health') {
      const result = await plaidPost('/institutions/get', { count: 1, offset: 0, country_codes: ['US'] }, config);
      return json(
        {
          ok: result.ok,
          env: config.envName,
          host: config.host,
          secretsTried: config.secrets.length,
          plaid: result.ok ? 'credentials accepted' : result.data,
        },
        result.ok ? 200 : 400,
      );
    }

    if (action === 'link_token') {
      const products = Array.isArray(body?.products) && body.products.length
        ? body.products
        : ['auth', 'transactions'];
      const result = await plaidPost(
        '/link/token/create',
        {
          user: { client_user_id: String(body?.user_id || 'levisbotuniverse-owner') },
          client_name: 'LevisBotUniverse',
          products,
          country_codes: ['US'],
          language: 'en',
        },
        config,
      );
      if (!result.ok) return json({ ok: false, env: config.envName, error: result.data }, 400);
      return json({
        ok: true,
        env: config.envName,
        link_token: result.data.link_token,
        expiration: result.data.expiration,
      });
    }

    if (action === 'exchange') {
      const publicToken = String(body?.public_token || '');
      if (!publicToken) return json({ error: 'public_token is required.' }, 400);

      const exchanged = await plaidPost('/item/public_token/exchange', { public_token: publicToken }, config);
      if (!exchanged.ok) return json({ ok: false, stage: 'exchange', error: exchanged.data }, 400);

      const { access_token: accessToken, item_id: itemId } = exchanged.data;
      const accounts = await plaidPost('/accounts/get', { access_token: accessToken }, config);
      const accountList = accounts.ok ? accounts.data.accounts || [] : [];

      let institutionName = String(body?.institution_name || '');
      if (!institutionName) {
        const item = await plaidPost('/item/get', { access_token: accessToken }, config);
        const institutionId = item.ok ? item.data?.item?.institution_id : '';
        if (institutionId) {
          const inst = await plaidPost('/institutions/get_by_id', { institution_id: institutionId, country_codes: ['US'] }, config);
          institutionName = inst.ok ? inst.data?.institution?.name || '' : '';
        }
      }

      const base44 = auth.base44 || createClientFromRequest(req);
      const record = {
        item_id: itemId,
        access_token: accessToken,
        institution_name: institutionName,
        env: config.envName,
        account_count: accountList.length,
        owner_email: auth.user?.email || 'service',
        accounts: accountList.map((a) => ({
          account_id: a.account_id,
          name: a.name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
        })),
        linked_at: new Date().toISOString(),
      };

      let saved = null;
      try {
        const existing = await base44.asServiceRole.entities.PlaidItem.filter({ item_id: itemId });
        saved = existing?.[0]
          ? await base44.asServiceRole.entities.PlaidItem.update(existing[0].id, record)
          : await base44.asServiceRole.entities.PlaidItem.create(record);
      } catch (error) {
        return json({ ok: false, stage: 'store', item_id: itemId, error: error?.message || String(error) }, 500);
      }

      return json({
        ok: true,
        env: config.envName,
        item_id: itemId,
        institution: institutionName,
        account_count: accountList.length,
        stored: Boolean(saved?.id),
        accounts: record.accounts,
      });
    }

    if (action === 'accounts') {
      const base44 = auth.base44 || createClientFromRequest(req);
      const items = body?.item_id
        ? await base44.asServiceRole.entities.PlaidItem.filter({ item_id: String(body.item_id) })
        : await base44.asServiceRole.entities.PlaidItem.list('-created_date', 25);
      if (!items?.length) return json({ ok: true, items: [], note: 'No linked Plaid items yet.' });

      const out = [];
      for (const item of items) {
        const cfg = { ...config, envName: item.env || config.envName, host: HOSTS[item.env] || config.host };
        const balances = await plaidPost('/accounts/balance/get', { access_token: item.access_token }, cfg);
        out.push({
          item_id: item.item_id,
          institution: item.institution_name,
          env: item.env,
          account_count: item.account_count,
          balances_ok: balances.ok,
          accounts: balances.ok ? balances.data.accounts : item.accounts,
        });
      }
      return json({ ok: true, items: out });
    }

    return json({ error: `Unknown action "${action}". Use health, link_token, exchange or accounts.` }, 400);
  } catch (error) {
    return json({ error: error?.message || String(error) }, 500);
  }
}
