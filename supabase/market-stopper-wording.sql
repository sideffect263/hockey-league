-- סטופר מרקט wording on the server (2026-10-27): the currency is סטופרים, the
-- game is predictions. Rewrites the Hebrew strings in place inside the functions
-- that carry them (bodies otherwise unchanged), plus the one stored market note.
-- Down: market-stopper-wording-down.sql (the same swap the other way).
do $$
declare def text;
begin
  for def in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('market_games_before_delete', 'market_games_after_update',
                         'market_games_after_update_body', 'analytics_activity', 'analytics_feature')
  loop
    execute replace(replace(def, 'כל המטבעות הוחזרו', 'כל הסטופרים הוחזרו'), 'הוקי מרקט', 'סטופר מרקט');
  end loop;
end $$;

update public.markets
   set resolution_note = replace(resolution_note, 'כל ההימורים הוחזרו במלואם', 'כל הסטופרים הוחזרו במלואם')
 where resolution_note like '%כל ההימורים הוחזרו במלואם%';
