-- dev-experiments.sql (2026-10-15)
-- Applied to production via MCP as migration `dev_experiments`.
--
-- /devs → ניסויים: a developer changes a pipeline setting, kookisnooki runs it on a fixed
-- benchmark, everyone sees the numbers next to today's default. Only an admin marks an
-- experiment "promoted"; making it the real default is a code change done afterwards.
--
-- The worker (video-analysis/devlab/worker.py on kookisnooki) never holds the service key.
-- It calls the dev_worker_* functions below with a worker secret; only the secret's sha256 is
-- stored (dev_worker_keys, no policies = unreadable through the API). Those functions can touch
-- nothing but experiments and read the review truth of the benchmark runs.
--
-- params is validated twice: lightly here (an object, small), strictly by the worker against
-- its whitelist (devlab/spec.py) — the worker is the authority, it never passes raw values on.

create table if not exists public.dev_experiments (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  stage         text not null check (stage in ('events', 'ball')),
  title         text not null check (length(trim(title)) between 1 and 120),
  hypothesis    text check (hypothesis is null or length(hypothesis) <= 2000),
  params        jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and pg_column_size(params) < 8000),
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'error', 'cancelled')),
  metrics       jsonb,             -- headline numbers, e.g. {f1, precision, recall, ...}
  baseline      jsonb,             -- the same numbers for today's default, measured in the same run
  result        jsonb,             -- per-type table, applied params, benchmark description
  log           text,
  worker        text,
  decision      text check (decision in ('promoted', 'rejected')),
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index if not exists dev_experiments_created_idx on public.dev_experiments (created_at desc);
create index if not exists dev_experiments_queue_idx on public.dev_experiments (created_at) where status = 'queued';
create index if not exists dev_experiments_creator_idx on public.dev_experiments (created_by);
create index if not exists dev_experiments_decider_idx on public.dev_experiments (decided_by);

alter table public.dev_experiments enable row level security;
create policy "dev reads experiments" on public.dev_experiments for select to authenticated
  using ((select public.is_developer()));
-- A new experiment can only be a fresh queued request by its author.
create policy "dev queues own experiment" on public.dev_experiments for insert to authenticated
  with check ((select public.is_developer()) and created_by = (select auth.uid()) and status = 'queued'
              and metrics is null and baseline is null and result is null and log is null and worker is null
              and decision is null and decided_by is null and started_at is null and finished_at is null);
-- No update/delete policies: state changes go through the functions below.

-- At most 5 waiting experiments per person, so one person can't fill the GPU queue.
create or replace function public.dev_experiments_queue_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.dev_experiments where created_by = new.created_by and status = 'queued') >= 5 then
    raise exception 'יש לך כבר 5 ניסויים בתור — חכו שאחד יסתיים';
  end if;
  return new;
end $$;
drop trigger if exists dev_experiments_queue_cap on public.dev_experiments;
create trigger dev_experiments_queue_cap before insert on public.dev_experiments
  for each row execute function public.dev_experiments_queue_cap();

-- Author (or admin) cancels a waiting experiment.
create or replace function public.dev_exp_cancel(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.dev_experiments set status = 'cancelled', finished_at = now()
   where id = p_id and status = 'queued' and (created_by = auth.uid() or public.is_admin());
$$;
revoke execute on function public.dev_exp_cancel(uuid) from public, anon;
grant execute on function public.dev_exp_cancel(uuid) to authenticated;

-- Admin decision on a finished experiment.
create or replace function public.dev_exp_decide(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_decision is not null and p_decision not in ('promoted', 'rejected') then raise exception 'bad decision'; end if;
  update public.dev_experiments
     set decision = p_decision, decision_note = nullif(trim(p_note), ''),
         decided_by = case when p_decision is null then null else auth.uid() end,
         decided_at = case when p_decision is null then null else now() end
   where id = p_id and status = 'done';
end $$;
revoke execute on function public.dev_exp_decide(uuid, text, text) from public, anon;
grant execute on function public.dev_exp_decide(uuid, text, text) to authenticated;

-- ── worker side ──────────────────────────────────────────────────────────────────────
create table if not exists public.dev_worker_keys (
  key_hash   text primary key,            -- hex sha256 of the worker secret
  label      text not null,
  created_at timestamptz not null default now()
);
alter table public.dev_worker_keys enable row level security;   -- no policies: not reachable through the API

create or replace function public.dev_worker_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_secret is not null and length(p_secret) >= 32
     and exists (select 1 from public.dev_worker_keys where key_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex'))
$$;
revoke execute on function public.dev_worker_ok(text) from public, anon, authenticated;

-- Take the oldest queued experiment of the given stages (or none).
create or replace function public.dev_worker_claim(p_secret text, p_worker text, p_stages text[])
returns setof public.dev_experiments
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.dev_worker_ok(p_secret) then raise exception 'bad worker secret'; end if;
  -- a run left 'running' for 3 h (worker died) goes back to the queue
  update public.dev_experiments set status = 'queued', started_at = null, worker = null
   where status = 'running' and started_at < now() - interval '3 hours';
  select id into v_id from public.dev_experiments
   where status = 'queued' and stage = any(p_stages)
   order by created_at limit 1 for update skip locked;
  if v_id is null then return; end if;
  return query update public.dev_experiments
     set status = 'running', started_at = now(), worker = left(p_worker, 60), log = null
   where id = v_id returning *;
end $$;

create or replace function public.dev_worker_log(p_secret text, p_id uuid, p_log text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.dev_worker_ok(p_secret) then raise exception 'bad worker secret'; end if;
  update public.dev_experiments set log = right(p_log, 20000) where id = p_id and status = 'running';
end $$;

create or replace function public.dev_worker_finish(p_secret text, p_id uuid, p_status text, p_metrics jsonb,
                                                    p_baseline jsonb, p_result jsonb, p_log text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.dev_worker_ok(p_secret) then raise exception 'bad worker secret'; end if;
  if p_status not in ('done', 'error') then raise exception 'bad status'; end if;
  update public.dev_experiments
     set status = p_status, metrics = p_metrics, baseline = p_baseline, result = p_result,
         log = right(p_log, 20000), finished_at = now()
   where id = p_id and status = 'running';
end $$;

-- Review truth for the event benchmark: every reviewed event of the given lab match runs.
create or replace function public.dev_worker_truth(p_secret text, p_runs uuid[])
returns table (run_id uuid, t real, type text, team text, verdict text, actual_type text, actual_team text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.dev_worker_ok(p_secret) then raise exception 'bad worker secret'; end if;
  return query select e.run_id, e.t, e.type, e.team, e.verdict, e.actual_type, e.actual_team
    from public.video_lab_match_events e where e.run_id = any(p_runs) and e.verdict is not null order by e.t;
end $$;

revoke execute on function public.dev_worker_claim(text, text, text[]) from public, authenticated;
revoke execute on function public.dev_worker_log(text, uuid, text) from public, authenticated;
revoke execute on function public.dev_worker_finish(text, uuid, text, jsonb, jsonb, jsonb, text) from public, authenticated;
revoke execute on function public.dev_worker_truth(text, uuid[]) from public, authenticated;
grant execute on function public.dev_worker_claim(text, text, text[]) to anon;
grant execute on function public.dev_worker_log(text, uuid, text) to anon;
grant execute on function public.dev_worker_finish(text, uuid, text, jsonb, jsonb, jsonb, text) to anon;
grant execute on function public.dev_worker_truth(text, uuid[]) to anon;
