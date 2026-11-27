# Deploying the console backend to Supabase (v20)

Base44 is gone from the backend. Eight Edge Functions replace the Base44 Deno
functions with the same names, so the URL paths stay the same:

    https://<REF>.supabase.co/functions/v1/bankingAuth
    https://<REF>.supabase.co/functions/v1/bankingPassword
    https://<REF>.supabase.co/functions/v1/foundryOps
    https://<REF>.supabase.co/functions/v1/operatorAI
    https://<REF>.supabase.co/functions/v1/plaidApi
    https://<REF>.supabase.co/functions/v1/foundryApi
    https://<REF>.supabase.co/functions/v1/stripeCheckout
    https://<REF>.supabase.co/functions/v1/maintenanceChief

Data lives in Postgres (supabase/migrations/0001_init.sql, plus indexes in
0002_foundry_api_maintenance.sql). The shared adapter
supabase/functions/_shared/store.ts gives the functions the same
list/filter/get/create/update/delete calls Base44 entities had;
supabase/functions/_shared/foundry.ts holds the starting-swarm seed that
foundryApi and maintenanceChief share.

| Function | Session | Actions |
|---|---|---|
| bankingAuth | public (it issues the session) | status, setup, login, me, logout |
| bankingPassword | owner | change password |
| foundryOps | owner (`tick` public, rate limited) | state, activity, bot, treasury, keys, live, record, feed, setAccount, funding, updateFunding, prospects, tick |
| operatorAI | owner | Operator chat |
| plaidApi | owner / service token | Plaid Link + reads |
| foundryApi | owner (`generate` public, capped at 6 pending) | state, draft, decide, toggle, retire, generate |
| stripeCheckout | public | plans, create, verify |
| maintenanceChief | owner | one health/maintenance pass per call |

## 1. Create / link the project

```sh
npm i -g supabase            # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <REF>      # run from the repo root
```

## 2. Run the SQL

Either push the migration:

```sh
supabase db push
```

or paste `supabase/migrations/0001_init.sql` and then
`supabase/migrations/0002_foundry_api_maintenance.sql` into Dashboard → SQL
Editor → Run.
It creates 9 tables (banking_owner, banking_session, banking_attempt,
foundry_bot, foundry_proposal, foundry_event, foundry_ledger, foundry_funding,
plaid_item), an updated_date trigger on each, and enables RLS with no policies
(only the service role used by the functions can read/write). 0002 adds no
tables: a unique index on `foundry_bot.slug` (so two first loads cannot seed
the swarm twice; skipped with a NOTICE if duplicate slugs already exist) and
indexes for session/attempt trimming and the maintenance event lookup.

## 3. Set the secrets

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions
automatically. Set the rest (only the ones you use; a missing provider key just
makes that desk say so):

```sh
supabase secrets set \
  OWNER_SETUP_KEY='<one-time key to claim the owner account>' \
  OPENAI_API_KEY='sk-...' \
  STRIPE_SECRET_KEY='sk_live_...' \
  MERCURY_API_TOKEN='...' \
  KRAKEN_API_KEY='...' KRAKEN_API_SECRET='...' \
  GOOGLE_PLACES_API_KEY='...' \
  PLAID_CLIENT_ID='...' PLAID_SECRET='...' PLAID_ENV='sandbox'
```

Full list the code reads:

| Secret | Used by | Notes |
|---|---|---|
| OWNER_SETUP_KEY | bankingAuth | required to claim the owner on first run |
| OPENAI_API_KEY | operatorAI | optional; without it the Operator answers from console state ("offline" mode) |
| OPENAI_MODEL | operatorAI | optional, default `gpt-4o-mini` |
| OPENAI_BASE_URL | operatorAI | optional, default `https://api.openai.com/v1` (any OpenAI-compatible API) |
| STRIPE_SECRET_KEY | foundryOps, stripeCheckout | live balance; Checkout Sessions for #/store and Treasury "Get paid". `sk_live_`/`rk_live_` = live, anything else = test mode. Without it the store still lists plans and checkout answers with a clear "STRIPE_SECRET_KEY is missing" error (503) |
| STRIPE_PRICE_INSTALL, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_FOUNDING | stripeCheckout | optional existing Stripe price ids (`price_...`). When set, checkout uses that price and the store shows its real amount; when unset, the session uses inline price_data at $950 one time / $39 per month / $250 one time |
| STORE_URL | stripeCheckout | optional fallback return page (e.g. `https://<user>.github.io/<repo>/`) when the client sends no `origin` |
| MERCURY_API_TOKEN | foundryOps | treasury balances |
| KRAKEN_API_KEY, KRAKEN_API_SECRET | foundryOps | balances (trade-only key) |
| GOOGLE_PLACES_API_KEY | foundryOps | prospector |
| OPENSEA_API_KEY, GUSTO_CLIENT_ID, GUSTO_CLIENT_SECRET | foundryOps | shown as connected/not on the keys desk only |
| PLAID_CLIENT_ID | plaidApi, foundryOps | |
| PLAID_SECRET / PLAID_SANDBOX_SECRET / PLAID_PRODUCTION_SECRET | plaidApi | tried in order per environment |
| PLAID_CLIENT_SECRET | foundryOps | keys desk only checks presence of this name |
| PLAID_ENV | plaidApi | `sandbox` or `production` |
| CONSOLE_SERVICE_TOKEN | plaidApi | optional bot-to-bot bearer (old name BASE44_SERVICE_TOKEN still accepted) |

## 4. Deploy the functions (in this order)

`supabase/config.toml` sets `verify_jwt = false` for each one, because the
console uses its own session tokens. Deploy auth first so you can sign in, then
the desks that depend on a session:

```sh
supabase functions deploy bankingAuth
supabase functions deploy bankingPassword
supabase functions deploy foundryOps
supabase functions deploy operatorAI
supabase functions deploy plaidApi
supabase functions deploy foundryApi
supabase functions deploy stripeCheckout
supabase functions deploy maintenanceChief
```

(`--no-verify-jwt` on each command does the same if config.toml is not picked up.)

## 5. Point the client at it and rebuild

Set at build time (e.g. `client/.env.production`, or CI env):

```
VITE_API_BASE=https://<REF>.supabase.co/functions/v1
# optional; only needed if the gateway asks for an apikey
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

Or replace the placeholder `https://SUPABASE_REF.supabase.co/functions/v1` in
`client/src/api/config.js`. Then `cd client && npm run build:pages` and publish
`docs/` as before. The old `VITE_API_URL` is no longer read, so a stale value
pointing at Base44 cannot leak back in.

Header contract: the console session token is sent as `x-console-token`. When
`VITE_SUPABASE_ANON_KEY` is set it rides in `apikey` + `Authorization: Bearer`;
otherwise the token is also sent in `Authorization: Bearer` (the functions
accept either).

## 6. First run

1. Open the console → it reports setup required → claim the owner with
   `OWNER_SETUP_KEY` (Base44 data is not migrated; the old owner, sessions,
   bots, ledger and Plaid items do not come across).
   Signing in fires one `maintenanceChief` pass, which seeds the starting
   swarm (Think Bot, Bot Maker, NFT/Buy/Sell Bot, Scraper Bot, Maintenance
   Bot, Treasury Bot, Fraud Watch, Payroll Runner, Spend Analyst, Fund Bot)
   when `foundry_bot` is empty; `foundryApi` state/draft/generate seed the
   same way if they run first.
2. Seed funding routes if you want the Fund Bot desk populated — the table is
   the route catalogue (route must be unique):

```sql
insert into foundry_funding (route, title, kind, status, est_amount, effort, why, cost, timeline, requirements)
values ('example-route', 'Example route', 'grant', 'idea', 10000, 'Low',
        'Why it fits', 'Free', '4-6 weeks', 'Business plan · EIN · Bank statements');
```

## Smoke test

```sh
curl -s -X POST https://<REF>.supabase.co/functions/v1/bankingAuth \
  -H 'content-type: application/json' -d '{"action":"status"}'
# -> {"setupRequired":true,"setupConfigured":true}
```

## Notes on the three v20 follow-up functions

- **foundryApi** is ported from `server/routes/foundry.js`. Differences: rows
  live in Postgres instead of a JSON file; Fund Bot is added to the seed; the
  event log is not capped at 200 rows; approving a concept whose slug matches a
  retired bot gets a suffixed slug (the unique index would reject a repeat).
- **stripeCheckout** had no source in the repo or `server/`; it is written
  against `client/src/api/billingApi.js`, `StorePage.jsx` and `BillingPanel.jsx`.
  Stripe returns customers to `<origin>#/store?paid=1&plan=<id>&session_id=...`
  (or `paid=0` on cancel), and the store confirms with `verify`.
- **maintenanceChief** had no source either; it checks every table, seeds an
  empty swarm, deletes expired sessions and lapsed lockout windows, adopts blank
  account fields, flags running bots without a charter and a feed older than two
  hours, stamps Maintenance Bot, and logs one `maintenance` event at most every
  10 minutes. Returns `{ ok, status: healthy|attention|degraded, tables, trimmed, seeded, roster, issues, note }`.

Smoke tests:

```sh
curl -s -X POST https://<REF>.supabase.co/functions/v1/stripeCheckout \
  -H 'content-type: application/json' -d '{"action":"plans"}'
curl -s -X POST https://<REF>.supabase.co/functions/v1/maintenanceChief \
  -H 'content-type: application/json' -H 'x-console-token: <session token>' -d '{}'
```

## v21: Control Hub

Tables (0004_control_hub.sql, RLS on, service role only): `bots`, `bot_runs`, `approvals`.
0005_gemini_key_vault.sql adds `set_gemini_key` / `get_gemini_key` (service role only) so the
Gemini key can live encrypted in Supabase Vault.

| Function | Session | Actions |
|---|---|---|
| bot-run | owner for test/live bots; public only for `missedcall-bot` when live (rate limited 12/10 min and 60/day per visitor, 400/day total) | `{ slug, message, history?, lead? }` |
| hub | owner | list, setStatus, runs, thumbs, approvals, decide, setAiKey |

AI: Google Gemini (`GEMINI_MODEL`, default gemini-2.5-flash). Key from function secret
`GEMINI_API_KEY`, else Vault (set it from Control Hub → "Connect"). Without a key bot-run answers
503 "AI key not connected yet".

Hard rule: bots never buy, sell, spend or commit. Such requests become `approvals` rows (pending);
deciding one in the hub records the decision only. Nothing in this build moves money.

Bots are seeded from the LevisBotUniverse roster with scripts/seed_bots.py (upsert; never changes status).
