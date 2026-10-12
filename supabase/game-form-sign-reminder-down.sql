-- Down for game-form-sign-reminder.sql
drop trigger if exists trg_notify_game_form_sign on public.games;
drop function if exists public.notify_game_form_sign();
drop function if exists public._game_form_signers(uuid);
drop function if exists public.sign_game_form_saved(uuid, text);
drop function if exists public.delete_my_signature();
drop function if exists public.save_my_signature(text);
drop function if exists public.my_saved_signature();
drop table if exists public.saved_signatures;
