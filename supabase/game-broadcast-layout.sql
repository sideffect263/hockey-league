-- Multi-view layout for the director's control room (2026-10-12).
--
-- The program camera stays the MAIN picture; `layout` says how the extra cameras in
-- `layout_cameras` (ordered) are shown with it on every viewer's screen:
--   single — the program camera only (as before)
--   pip    — the first extra camera inset in a corner of the program
--   side   — program and the first extra side by side
--   grid   — 2x2: program + up to three extras
-- Nothing is mixed on a server: each viewer's page plays the cameras itself and follows
-- these settings over realtime (like program_camera_no). Same RLS as the rest of the row
-- (public read, admin write). Apps that don't know the columns keep showing the program.
alter table public.game_broadcast
  add column if not exists layout text not null default 'single'
    check (layout in ('single', 'pip', 'side', 'grid')),
  add column if not exists layout_cameras smallint[] not null default '{}'
    check (cardinality(layout_cameras) <= 3);
