import { CORS_ALLOW_HEADERS } from '../_shared/store.ts';

/**
 * Stripe Checkout for the Tap Card System store (#/store) and the Treasury
 * "Get paid" panel. Public: a shop owner pays without an account here, so no
 * console session is required.
 *
 * Actions (client/src/api/billingApi.js):
 *   plans                         -> { plans: [{ id, label, amount, mode, currency, priced }], live, configured }
 *   create { plan, email, origin } -> { url, id, plan (label), planId, amount, mode, live }
 *   verify { session_id }         -> { paid, status, plan (id), email, amount, currency, live }
 *
 * The secret key never leaves this function. Prices: if STRIPE_PRICE_<PLAN>
 * holds an existing Stripe price id it is used (and its real amount shown);
 * otherwise the session carries inline price_data at the store's listed price.
 * Amounts are in dollars, as the client's money() formatter expects.
 */

const STRIPE = 'https://api.stripe.com/v1';

type Plan = {
  id: string;
  label: string;
  amount: number; // dollars
  mode: 'payment' | 'subscription';
  description: string;
  priceEnv: string;
};

// Listed prices from client/src/components/StorePage.jsx ($950 install,
// $39/month) and the founding offer page (docs/offer, Founding Access $250).
const PLANS: Plan[] = [
  {
    id: 'install',
    label: 'Counter install',
    amount: 950,
    mode: 'payment',
    description: 'Tap Card System station installed and tested: reader, screen, mount, 100 reload cards, staff training.',
    priceEnv: 'STRIPE_PRICE_INSTALL',
  },
  {
    id: 'monthly',
    label: 'Monthly service',
    amount: 39,
    mode: 'subscription',
    description: 'Hosting, support, card reorders and a monthly balance report, per site. Cancel any time.',
    priceEnv: 'STRIPE_PRICE_MONTHLY',
  },
  {
    id: 'founding',
    label: 'Founding seat',
    amount: 250,
    mode: 'payment',
    description: 'A seat in the LevisBot Universe console before it opens, founding price locked.',
    priceEnv: 'STRIPE_PRICE_FOUNDING',
  },
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

const secretKey = () => (Deno.env.get('STRIPE_SECRET_KEY') || '').trim();
const isLive = (key: string) => /^(sk|rk)_live_/.test(key);

const MISSING_KEY =
  'Payments are not set up yet: STRIPE_SECRET_KEY is missing on the server. Add it with `supabase secrets set STRIPE_SECRET_KEY=sk_...`.';

class StripeError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

async function stripe(path: string, key: string, form?: URLSearchParams) {
  let response: Response;
  try {
    response = await fetch(`${STRIPE}${path}`, {
      method: form ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? form.toString() : undefined,
    });
  } catch {
    throw new StripeError('Stripe did not answer. Try again in a moment.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe responded ${response.status}.`;
    throw new StripeError(message, response.status === 401 ? 502 : response.status >= 500 ? 502 : 400);
  }
  return payload;
}

/** Real amount and mode of a configured Stripe price, so the store never shows a stale number. */
async function resolvePlan(plan: Plan, key: string) {
  const priceId = (Deno.env.get(plan.priceEnv) || '').trim();
  if (!priceId || !key) return { ...plan, priceId: '', currency: 'usd', priced: false };
  try {
    const price = await stripe(`/prices/${encodeURIComponent(priceId)}`, key);
    return {
      ...plan,
      priceId,
      amount: Number(price?.unit_amount || 0) / 100 || plan.amount,
      mode: (price?.recurring ? 'subscription' : 'payment') as Plan['mode'],
      currency: String(price?.currency || 'usd'),
      priced: true,
    };
  } catch (problem) {
    console.warn('price lookup failed', plan.id, String(problem));
    return { ...plan, priceId, currency: 'usd', priced: false };
  }
}

const publicPlan = (plan: any) => ({
  id: plan.id,
  label: plan.label,
  amount: plan.amount,
  mode: plan.mode,
  currency: plan.currency || 'usd',
  priced: Boolean(plan.priced),
});

/** Where Stripe sends the customer back. Only http(s), no credentials, no existing hash. */
function returnBase(req: Request, origin: unknown) {
  const candidates = [String(origin || ''), Deno.env.get('STORE_URL') || '', req.headers.get('origin') || ''];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      url.hash = '';
      url.search = '';
      return url.toString();
    } catch {
      // try the next one
    }
  }
  return '';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    if (error instanceof StripeError) return json(req, { error: error.message }, error.status);
    console.error('stripeCheckout failure', error);
    return json(req, { error: 'The payment endpoint hit a problem. Try again in a moment.' }, 500);
  }
});

async function handle(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const key = secretKey();
  const action = String(body.action || 'plans');

  if (action === 'plans') {
    // Listed even without a key, so the storefront still renders; checkout says why it can't start.
    const plans = await Promise.all(PLANS.map((plan) => resolvePlan(plan, key)));
    return json(req, { plans: plans.map(publicPlan), live: isLive(key), configured: Boolean(key) });
  }

  if (action === 'create') {
    if (!key) return json(req, { error: MISSING_KEY }, 503);

    const base = PLANS.find((plan) => plan.id === String(body.plan || ''));
    if (!base) return json(req, { error: 'Pick a plan: install, monthly or founding.' }, 400);

    const back = returnBase(req, body.origin);
    if (!back) return json(req, { error: 'The checkout needs a page to return to.' }, 400);

    const plan = await resolvePlan(base, key);
    const email = String(body.email || '').trim().slice(0, 200);

    const form = new URLSearchParams();
    form.set('mode', plan.mode);
    form.set('success_url', `${back}#/store?paid=1&plan=${plan.id}&session_id={CHECKOUT_SESSION_ID}`);
    form.set('cancel_url', `${back}#/store?paid=0&plan=${plan.id}`);
    form.set('line_items[0][quantity]', '1');
    if (plan.priceId) {
      form.set('line_items[0][price]', plan.priceId);
    } else {
      form.set('line_items[0][price_data][currency]', 'usd');
      form.set('line_items[0][price_data][unit_amount]', String(Math.round(plan.amount * 100)));
      form.set('line_items[0][price_data][product_data][name]', `Tap Card System — ${plan.label}`);
      form.set('line_items[0][price_data][product_data][description]', plan.description);
      if (plan.mode === 'subscription') form.set('line_items[0][price_data][recurring][interval]', 'month');
    }
    if (email && EMAIL.test(email)) form.set('customer_email', email);
    if (plan.mode === 'payment') form.set('customer_creation', 'always');
    form.set('allow_promotion_codes', 'true');
    form.set('billing_address_collection', 'auto');
    form.set('client_reference_id', plan.id);
    form.set('metadata[plan]', plan.id);
    if (plan.mode === 'subscription') form.set('subscription_data[metadata][plan]', plan.id);
    else form.set('payment_intent_data[metadata][plan]', plan.id);

    const session = await stripe('/checkout/sessions', key, form);
    if (!session?.url) return json(req, { error: 'Stripe did not return a checkout link. Try again in a moment.' }, 502);

    return json(req, {
      url: session.url,
      id: session.id,
      plan: plan.label,
      planId: plan.id,
      amount: plan.amount,
      mode: plan.mode,
      live: isLive(key),
    });
  }

  if (action === 'verify') {
    if (!key) return json(req, { error: MISSING_KEY }, 503);
    const sessionId = String(body.session_id || '').trim();
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json(req, { error: 'That checkout id does not look right.' }, 400);

    const session = await stripe(`/checkout/sessions/${encodeURIComponent(sessionId)}`, key);
    const paid = session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required';
    return json(req, {
      paid,
      status: session?.status || '',
      plan: session?.metadata?.plan || session?.client_reference_id || '',
      email: session?.customer_details?.email || session?.customer_email || '',
      amount: Number(session?.amount_total || 0) / 100,
      currency: session?.currency || 'usd',
      live: Boolean(session?.livemode),
    });
  }

  return json(req, { error: 'Unknown action.' }, 400);
}
