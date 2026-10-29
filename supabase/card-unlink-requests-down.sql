-- Undo card-unlink-requests.sql (run card-unlink-requests-enforce-down.sql first if the
-- enforce step was applied). Unlinks already approved stay unlinked.
drop trigger if exists trg_notify_new_card_unlink_request on public.card_unlink_requests;
drop function if exists public.notify_admins_new_card_unlink_request();
drop function if exists public.decide_card_unlink_request(uuid, boolean);
drop function if exists public.pending_card_unlink_requests();
drop function if exists public.cancel_card_unlink_request();
drop function if exists public.request_card_unlink(text);
drop function if exists public.unlink_account_from_card(uuid);
drop table if exists public.card_unlink_requests;
notify pgrst, 'reload schema';
