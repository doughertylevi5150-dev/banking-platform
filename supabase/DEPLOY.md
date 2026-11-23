# Deploying the console backend to Supabase (v20)

Base44 is gone from the backend. Five Edge Functions replace the Base44 Deno
functions with the same names, so the URL paths stay the same:

    https://<REF>.supabase.co/functions/v1/bankingAuth
    https://<REF>.supabase.co/functions/v1/bankingPassword
    https://<REF>.supabase.co/functions/v1/foundryOps
    https://<REF>.supabase.co/functions/v1/operatorAI
    https://<REF>.supabase.co/functions/v1/plaidApi

Data lives in Postgres (supabase/migrations/0001_init.sql). The shared adapter
supabase/functions/_shared/store.ts gives the functions the same
list/filter/get/create/update/delete calls Base44 entities had.

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

or paste `supabase/migrations/0001_init.sql` into Dashboard → SQL Editor → Run.
It creates 9 tables (banking_owner, banking_session, banking_attempt,
foundry_bot, foundry_proposal, foundry_event, foundry_ledger, foundry_funding,
plaid_item), an updated_date trigger on each, and enables RLS with no policies
(only the service role used by the functions can read/write).

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
| STRIPE_SECRET_KEY | foundryOps | live balance |
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

## Not covered by these five functions

The client also calls `foundryApi` (state/draft/decide/toggle/retire),
`stripeCheckout` and `maintenanceChief`. Their Base44 sources are not in this
repo, so they are not deployed here; those buttons will fail until they are
ported (`server/routes/foundry.js` mirrors `foundryApi` and is the best
starting point).
