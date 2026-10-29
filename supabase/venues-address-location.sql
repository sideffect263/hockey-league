-- Rink address + map pin (2026-10-29). Set in /admin מגרשים; the apps' ניווט and the MCP
-- server navigate to lat/lng. Applied LIVE via MCP apply_migration venues_address_location.
alter table public.venues
  add column if not exists address text,
  add column if not exists lat double precision,
  add column if not exists lng double precision;
alter table public.venues
  add constraint venues_lat_range check (lat is null or (lat between -90 and 90)),
  add constraint venues_lng_range check (lng is null or (lng between -180 and 180)),
  add constraint venues_latlng_both check ((lat is null) = (lng is null));
comment on column public.venues.lat is 'Rink entrance pin, set in /admin מגרשים; apps navigate here (ניווט).';
