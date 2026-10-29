alter table public.venues
  drop constraint if exists venues_latlng_both,
  drop constraint if exists venues_lng_range,
  drop constraint if exists venues_lat_range,
  drop column if exists lng,
  drop column if exists lat,
  drop column if exists address;
