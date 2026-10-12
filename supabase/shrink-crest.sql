-- Applied LIVE 2026-10-12 (migration teams_shrink_crest_trigger).
-- Every new crest is re-encoded to <=256px by the shrink-crest edge function.
-- All clients (web, iOS, Android) end an upload with set_team_logo(), so a trigger
-- here covers them all with no app release. The function writes logo_url back to a
-- "crest-256-*" file, which this trigger skips, so it cannot loop.
create or replace function public.teams_shrink_crest()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_key text;
begin
  if new.logo_url is null
     or new.logo_url is not distinct from old.logo_url
     or new.logo_url not like 'https://slpwwoupbbxcgjivcspv.supabase.co/storage/v1/object/public/team-logos/' || new.id || '/%'
     or new.logo_url like '%/crest-256%' then
    return new;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ingest_service_key' limit 1;
  if v_key is null then
    raise warning 'ingest_service_key missing from vault - crest not shrunk';
    return new;
  end if;
  perform net.http_post(
    url     := 'https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/shrink-crest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('team_id', new.id, 'url', new.logo_url),
    timeout_milliseconds := 60000
  );
  return new;
exception when others then
  return new;  -- never block saving a crest
end $$;

revoke all on function public.teams_shrink_crest() from public, anon, authenticated;

drop trigger if exists teams_shrink_crest on public.teams;
create trigger teams_shrink_crest
  after update of logo_url on public.teams
  for each row execute function public.teams_shrink_crest();
