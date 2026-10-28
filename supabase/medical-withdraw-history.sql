-- Medical certificate history: a player can replace or withdraw an upload, and every
-- past upload is kept (2026-10-28, Ariel). Nothing here deletes a row or a file.
--
--  • status 'withdrawn' (+ withdrawn_at / withdrawn_by). A withdrawn row is never valid:
--    every eligibility check already requires status = 'approved'.
--  • medical_withdraw(p_id, p_confirm) — marks one row withdrawn. The player himself may
--    withdraw only an open one (pending / pending_manager). An APPROVED row can be withdrawn
--    only by his coach, a league manager or an admin, with p_confirm = true (the client shows
--    a confirm sheet); his coaches + the league managers + the player are told, because he
--    can no longer register for games (Ariel, 2026-10-28).
--  • "Replace": a new pending upload while one is still open (pending / pending_manager)
--    marks the open one withdrawn instead of failing on medical_certificates_one_open.
--    An approved, in-date certificate is NOT touched — the player keeps playing on it until
--    the new one is approved.
--  • No hard deletes from clients: the player's row DELETE policy goes, and a storage file
--    can only be removed while no certificate row points at it (orphan clean-up still works).
--  • Reviewers can no longer act on a withdrawn row.

-- 1. status + columns -------------------------------------------------------------------
alter table public.medical_certificates
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references auth.users(id) on delete set null;

alter table public.medical_certificates drop constraint medical_certificates_status_check;
alter table public.medical_certificates add constraint medical_certificates_status_check
  check (status = any (array['pending','pending_manager','approved','rejected','withdrawn']));

-- 2. withdraw RPC ------------------------------------------------------------------------
create or replace function public.medical_withdraw(p_id uuid, p_confirm boolean default false)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player uuid; v_team uuid; v_status text; v_name text; rec record;
  v_self boolean; v_staff boolean;
begin
  select mc.player_id, mc.status, pl.team_id, btrim(coalesce(pl.first_name,'') || ' ' || coalesce(pl.last_name,''))
    into v_player, v_status, v_team, v_name
    from public.medical_certificates mc join public.players pl on pl.id = mc.player_id
   where mc.id = p_id
   for update of mc;
  if v_player is null then raise exception 'not found'; end if;

  v_self := v_player is not distinct from public.my_player_id();
  v_staff := coalesce(public.is_admin(), false)
          or coalesce(public.is_league_manager(), false)
          or coalesce(public.is_coach_of_player(v_player), false);
  if not (v_self or v_staff) then raise exception 'not authorized'; end if;

  if v_status not in ('pending','pending_manager','approved') then
    raise exception 'not withdrawable';
  end if;
  if v_status = 'approved' and not v_staff then raise exception 'approved needs staff'; end if;
  if v_status = 'approved' and not coalesce(p_confirm, false) then
    raise exception 'confirm required';
  end if;

  update public.medical_certificates
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = (select auth.uid())
   where id = p_id;

  -- Losing an approved certificate blocks game sign-ups, so the people who squad him must
  -- know. Reuses medical_revoked (bell + push copy already exist on every client).
  if v_status = 'approved' then
    for rec in
      select user_id, bool_and(for_coach) as for_coach from (
        select pr.id as user_id, false as for_coach from public.profiles pr where pr.player_id = v_player
        union all
        select ur.user_id, true from public.user_roles ur where ur.role = 'coach' and ur.team_id = v_team
        union all
        select ur.user_id, true from public.user_roles ur where ur.role = 'league_manager'
      ) x group by user_id
    loop
      if rec.user_id is not null and rec.user_id <> (select auth.uid()) then
        perform public.create_notification(
          rec.user_id, 'medical_revoked', (select auth.uid()), 'player', v_player::text,
          jsonb_build_object('player_name', coalesce(v_name,''),
                             'reason', 'האישור הוסר',
                             'withdrawn', true)
            || case when rec.for_coach then jsonb_build_object('for_coach', true) else '{}'::jsonb end);
      end if;
    end loop;
  end if;
  return v_status;
end;
$function$;

revoke all on function public.medical_withdraw(uuid, boolean) from public, anon;
grant execute on function public.medical_withdraw(uuid, boolean) to authenticated;

-- 3. replace: a new pending upload retires the open one ---------------------------------
create or replace function public.medical_replace_open()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.status = 'pending' then
    update public.medical_certificates
       set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = NEW.uploaded_by
     where player_id = NEW.player_id
       and status in ('pending','pending_manager');
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_medical_replace_open on public.medical_certificates;
create trigger trg_medical_replace_open
  before insert on public.medical_certificates
  for each row execute function public.medical_replace_open();

-- 4. no hard deletes from clients ---------------------------------------------------------
drop policy if exists "player deletes own pending medical" on public.medical_certificates;

create or replace function public.medical_file_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.medical_certificates where file_path = p_name)
$function$;
revoke all on function public.medical_file_in_use(text) from public, anon;
grant execute on function public.medical_file_in_use(text) to authenticated;

drop policy if exists "medical delete own" on storage.objects;
create policy "medical delete own" on storage.objects for delete
  using (bucket_id = 'medical'
         and (storage.foldername(name))[1] = (public.my_player_id())::text
         and not public.medical_file_in_use(name));

drop policy if exists "medical delete own upload" on storage.objects;
create policy "medical delete own upload" on storage.objects for delete
  using (bucket_id = 'medical'
         and owner = auth.uid()
         and not public.medical_file_in_use(name));

-- 5. reviewers can't act on a withdrawn row ---------------------------------------------
create or replace function public.review_medical_certificate(p_id uuid, p_status text, p_exam_date date default null::date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_team uuid; v_status text;
begin
  if p_status not in ('approved','rejected') then raise exception 'bad status'; end if;
  select pl.team_id, mc.status into v_team, v_status
    from public.medical_certificates mc join public.players pl on pl.id = mc.player_id
   where mc.id = p_id;
  if v_team is null then raise exception 'not found'; end if;
  if not (public.is_admin() or public.is_league_manager() or public.is_coach_of(v_team)) then
    raise exception 'not authorized';
  end if;
  if v_status = 'withdrawn' then raise exception 'withdrawn'; end if;
  if p_status = 'approved' then
    if p_exam_date is null then raise exception 'exam date required'; end if;
    if p_exam_date > current_date then raise exception 'exam date in future'; end if;
    update public.medical_certificates
       set status = 'pending_manager', exam_date = p_exam_date,
           expires_at = p_exam_date + interval '1 year',
           coach_reviewed_at = now(), coach_reviewed_by = (select auth.uid()),
           reviewed_at = now(), reviewed_by = (select auth.uid())
     where id = p_id;
  else
    update public.medical_certificates
       set status = 'rejected', reviewed_at = now(), reviewed_by = (select auth.uid())
     where id = p_id;
  end if;
end;
$function$;
