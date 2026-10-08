-- Medical import from Podium (2026-10-08).
--
-- Every Podium-registered athlete already uploaded his physical to Podium; 10 of the
-- 61 paid ones never re-uploaded it here, so they read "missing" in מעקב רפואי.
-- scripts/podium-sync.mjs now copies the Podium file into the private `medical`
-- bucket for any linked player with no open and no currently-valid certificate,
-- and inserts it as 'pending_manager' — straight to the league manager's queue
-- (Ariel's call), skipping the coach stage. Inserting as pending_manager fires no
-- coach notification (notify_medical_submitted only acts on 'pending').
--
-- podium_source = the Podium file's storage object (URL without the token). It is
-- what stops a REJECTED import from being re-imported on the next run: the same
-- file is never imported twice; a new file on Podium (next season's physical) is.
alter table public.medical_certificates add column if not exists podium_source text;
create index if not exists medical_certificates_podium_source_idx
  on public.medical_certificates (podium_source) where podium_source is not null;

-- 2026-10-08 (same day): the first import carried NO exam date, and the LM queue had
-- no date field, so two approvals landed as "valid, no expiry". Fixes:
--   * podium-sync now sets exam_date = Podium's staticMedicalApproveCreated (+1y expiry)
--   * the 10 imports were backfilled the same way
--   * approve_medical_podium takes an optional exam date and REFUSES to approve a
--     certificate that would end up with none. Old callers (native apps) pass p_id only;
--     coach-approved rows always carry a date already, so they are unaffected.
drop function if exists public.approve_medical_podium(uuid);
create or replace function public.approve_medical_podium(p_id uuid, p_exam_date date default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_status text; v_exam date;
begin
  if not (public.is_admin() or coalesce(public.is_league_manager(), false)) then
    raise exception 'not authorized';
  end if;
  select mc.status, coalesce(p_exam_date, mc.exam_date) into v_status, v_exam
    from public.medical_certificates mc where mc.id = p_id;
  if v_status is null then raise exception 'not found'; end if;
  if v_status <> 'pending_manager' then raise exception 'not awaiting manager'; end if;
  if v_exam is null then raise exception 'exam date required'; end if;
  if v_exam > current_date then raise exception 'exam date in future'; end if;

  update public.medical_certificates
     set status = 'approved', podium_registered = true,
         exam_date = v_exam, expires_at = v_exam + interval '1 year',
         podium_verified_at = now(), podium_verified_by = (select auth.uid()),
         reviewed_at = now(), reviewed_by = (select auth.uid())
   where id = p_id;
end;
$$;
revoke all on function public.approve_medical_podium(uuid, date) from public, anon;
grant execute on function public.approve_medical_podium(uuid, date) to authenticated;
