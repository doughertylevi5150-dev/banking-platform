-- v20 follow-up: foundryApi, stripeCheckout, maintenanceChief.
-- No new tables are needed; the three functions use the 0001 tables.
-- This adds the indexes they lean on.

-- One bot per slug, so two first console loads racing to seed the swarm
-- cannot insert the starting bots twice (foundryApi / maintenanceChief catch
-- the conflict and re-read). Skipped, with a notice, if duplicates already
-- exist; dedupe foundry_bot by slug and re-run to get the guard.
do $$
begin
  if exists (
    select 1 from public.foundry_bot where slug is not null group by slug having count(*) > 1
  ) then
    raise notice 'foundry_bot has duplicate slugs; unique index foundry_bot_slug_key not created';
  else
    create unique index if not exists foundry_bot_slug_key on public.foundry_bot (slug);
  end if;
end $$;

-- maintenanceChief trims expired sessions and stale lockout windows.
create index if not exists banking_session_expires_at_idx on public.banking_session (expires_at);
create index if not exists banking_attempt_window_start_idx on public.banking_attempt (window_start);

-- maintenanceChief rate-limits itself on its last event.
create index if not exists foundry_event_kind_created_idx on public.foundry_event (kind, created_date desc);
