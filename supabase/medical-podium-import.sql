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
