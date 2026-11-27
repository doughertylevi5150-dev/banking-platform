-- The Gemini key can live in Supabase Vault (encrypted) instead of a function
-- env secret, so it can be set from the owner hub without anyone reading it.
-- bot-run uses env GEMINI_API_KEY first, then this vault entry.
create or replace function public.set_gemini_key(k text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name = 'GEMINI_API_KEY';
  perform vault.create_secret(k, 'GEMINI_API_KEY', 'Gemini key for bot-run');
end;
$$;

create or replace function public.get_gemini_key() returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'GEMINI_API_KEY' limit 1;
$$;

revoke execute on function public.set_gemini_key(text) from public, anon, authenticated;
revoke execute on function public.get_gemini_key() from public, anon, authenticated;
grant execute on function public.set_gemini_key(text) to service_role;
grant execute on function public.get_gemini_key() to service_role;
