-- Undo market-stopper-wording.sql: the old הוקי מרקט / מטבעות strings back.
do $$
declare def text;
begin
  for def in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('market_games_before_delete', 'market_games_after_update',
                         'market_games_after_update_body', 'analytics_activity', 'analytics_feature')
  loop
    execute replace(replace(def, 'כל הסטופרים הוחזרו', 'כל המטבעות הוחזרו'), 'סטופר מרקט', 'הוקי מרקט');
  end loop;
end $$;

update public.markets
   set resolution_note = replace(resolution_note, 'כל הסטופרים הוחזרו במלואם', 'כל ההימורים הוחזרו במלואם')
 where resolution_note like '%כל הסטופרים הוחזרו במלואם%';
