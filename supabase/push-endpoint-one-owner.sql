-- One device endpoint belongs to ONE account (2026-10-12).
-- Signing out on a phone never removed its push_subscriptions row, and send-push picks
-- rows by user_id only — so after A signed out and B signed in on the same phone, A's
-- pushes kept landing on B's screen. Whoever registers an endpoint last owns it: the
-- other accounts' rows for that endpoint are deleted. (Clients also delete their own row
-- on sign-out now; this covers older builds and a sign-out that ran offline.)
create or replace function public.push_endpoint_single_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions
   where endpoint = new.endpoint and user_id is distinct from new.user_id;
  return null;
end $$;

drop trigger if exists push_endpoint_single_owner on public.push_subscriptions;
create trigger push_endpoint_single_owner
  after insert or update of endpoint, user_id on public.push_subscriptions
  for each row execute function public.push_endpoint_single_owner();

-- One-off cleanup: keep only the most recently seen owner of each shared endpoint.
delete from public.push_subscriptions p
 using public.push_subscriptions q
 where p.endpoint = q.endpoint and p.user_id <> q.user_id
   and coalesce(p.last_seen_at, p.created_at) < coalesce(q.last_seen_at, q.created_at);
