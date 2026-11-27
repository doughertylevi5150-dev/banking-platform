-- Control Hub: the bot roster, every bot run, and the owner's approvals inbox.
-- RLS on with no policies: only the service role (edge functions bot-run and hub)
-- can read or write. anon / authenticated get nothing.

create table if not exists public.bots (
  slug text primary key,
  name text not null,
  one_task text not null default '',
  version text not null default 'v1',
  score text not null default '',
  status text not null default 'off' check (status in ('off', 'test', 'live')),
  prompt text not null default '',
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_runs (
  id uuid primary key default gen_random_uuid(),
  bot text not null references public.bots (slug) on update cascade,
  input text not null,
  output text,
  created_at timestamptz not null default now(),
  thumbs smallint check (thumbs in (-1, 1)),
  flagged boolean not null default false,          -- thumbs-down rows go to the Evolver
  source text not null default 'owner',            -- owner | public
  client_hash text,                                -- salted hash of caller IP, for rate limits only
  model text,
  ok boolean not null default true
);
create index if not exists bot_runs_bot_created_idx on public.bot_runs (bot, created_at desc);
create index if not exists bot_runs_client_created_idx on public.bot_runs (client_hash, created_at desc);
create index if not exists bot_runs_flagged_idx on public.bot_runs (flagged) where flagged;

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  bot text not null,
  kind text not null check (kind in ('buy', 'sell', 'spend', 'commitment', 'other')),
  summary text not null,
  amount numeric,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  run_id uuid references public.bot_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists approvals_status_created_idx on public.approvals (status, created_at desc);

alter table public.bots enable row level security;
alter table public.bot_runs enable row level security;
alter table public.approvals enable row level security;

revoke all on public.bots, public.bot_runs, public.approvals from anon, authenticated;
grant select, insert, update, delete on public.bots, public.bot_runs, public.approvals to service_role;
