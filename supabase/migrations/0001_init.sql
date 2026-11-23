-- LevisBotUniverse banking console: Base44 entities -> Postgres tables.
-- One table per entity (snake_case). Every table has Base44's built-in
-- id / created_date / updated_date. RLS is on with no policies: only the
-- edge functions (service role) can read or write.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_date()
returns trigger language plpgsql as $$
begin
  new.updated_date := now();
  return new;
end;
$$;

-- BankingOwner (bankingAuth, bankingPassword, foundryOps, operatorAI, plaidApi)
create table if not exists public.banking_owner (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  email text not null,
  name text,
  role text not null default 'owner',
  password_hash text not null,
  created_at timestamptz default now()
);
create unique index if not exists banking_owner_email_key on public.banking_owner (lower(email));

-- BankingSession (session token hashes, 7-day expiry)
create table if not exists public.banking_session (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  token_hash text not null,
  owner_email text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists banking_session_token_hash_idx on public.banking_session (token_hash);
create index if not exists banking_session_owner_email_idx on public.banking_session (owner_email);

-- BankingAttempt (login lockout window, keyed by email)
create table if not exists public.banking_attempt (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  key text not null,
  count integer not null default 0,
  window_start timestamptz not null default now()
);
create index if not exists banking_attempt_key_idx on public.banking_attempt (key);

-- FoundryBot (the swarm)
create table if not exists public.foundry_bot (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  name text,
  slug text,
  class_label text,
  charter text,
  revenue_model text,
  risk_level text,
  status text default 'running',
  source text,
  est_monthly numeric default 0,
  last_action text,
  account_status text,
  account_provider text,
  account_needs text,
  last_run timestamptz,
  last_result text,
  created_at timestamptz default now()
);
create index if not exists foundry_bot_slug_idx on public.foundry_bot (slug);

-- FoundryProposal (bot ideas waiting on the owner)
create table if not exists public.foundry_proposal (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  title text,
  slug text,
  class_label text,
  charter text,
  revenue_model text,
  risk_level text,
  est_monthly numeric default 0,
  status text default 'pending',
  source text,
  decided_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists foundry_proposal_status_idx on public.foundry_proposal (status);

-- FoundryEvent (activity log)
create table if not exists public.foundry_event (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  kind text,
  message text,
  bot_slug text,
  amount numeric,
  created_at timestamptz default now()
);
create index if not exists foundry_event_created_date_idx on public.foundry_event (created_date desc);
create index if not exists foundry_event_bot_slug_idx on public.foundry_event (bot_slug);

-- FoundryLedger (earnings, expenses, transfers, valuations)
create table if not exists public.foundry_ledger (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  bot_slug text,
  kind text,
  amount numeric default 0,
  currency text default 'USD',
  note text,
  source text,
  occurred_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists foundry_ledger_created_date_idx on public.foundry_ledger (created_date desc);
create index if not exists foundry_ledger_bot_slug_idx on public.foundry_ledger (bot_slug);

-- FoundryFunding (Fund Bot routes; the table is the route catalogue)
create table if not exists public.foundry_funding (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  route text not null,
  title text,
  kind text,
  status text default 'idea',
  est_amount numeric default 0,
  effort text,
  why text,
  cost text,
  timeline text,
  requirements text default '',
  notes text default ''
);
create unique index if not exists foundry_funding_route_key on public.foundry_funding (route);

-- PlaidItem (linked banks; access_token stays server side)
create table if not exists public.plaid_item (
  id uuid default gen_random_uuid() primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  item_id text not null,
  access_token text not null,
  institution_name text,
  env text,
  account_count integer default 0,
  owner_email text,
  accounts jsonb default '[]'::jsonb,
  linked_at timestamptz default now()
);
create unique index if not exists plaid_item_item_id_key on public.plaid_item (item_id);

-- updated_date triggers + RLS (no policies = no anon/authenticated access)
do $$
declare t text;
begin
  foreach t in array array[
    'banking_owner', 'banking_session', 'banking_attempt',
    'foundry_bot', 'foundry_proposal', 'foundry_event', 'foundry_ledger', 'foundry_funding',
    'plaid_item'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_date()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
