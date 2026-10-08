-- medical-upload-on-behalf.sql  (2026-10-08, Itai: "players get confused uploading")
-- ---------------------------------------------------------------------------
-- A coach (of that player), a league manager or an admin may upload a player's
-- yearly physical FOR him, into the same private bucket path "<player_id>/<file>".
-- The row still starts 'pending' and goes through review_medical_certificate —
-- the uploader's own sign-off (with the exam date) moves it to pending_manager,
-- so the manager's פודיום check is never skipped.
-- The uploader may delete only objects he uploaded himself (owner), which is
-- what the client needs to roll back a failed insert.
-- ---------------------------------------------------------------------------

drop policy if exists "medical upload by coach/manager" on storage.objects;
create policy "medical upload by coach/manager" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'medical' and (
      coalesce(public.is_admin(), false)
      or coalesce(public.is_league_manager(), false)
      or exists (select 1 from public.players pl
                  where pl.id::text = (storage.foldername(name))[1]
                    and coalesce(public.is_coach_of_player(pl.id), false))
    )
  );

drop policy if exists "medical delete own upload" on storage.objects;
create policy "medical delete own upload" on storage.objects
  for delete to authenticated
  using (bucket_id = 'medical' and owner = auth.uid());

drop policy if exists "coach/manager inserts medical for player" on public.medical_certificates;
create policy "coach/manager inserts medical for player" on public.medical_certificates
  for insert to authenticated
  with check (
    status = 'pending' and uploaded_by = auth.uid() and (
      coalesce(public.is_admin(), false)
      or coalesce(public.is_league_manager(), false)
      or coalesce(public.is_coach_of_player(player_id), false)
    )
  );
