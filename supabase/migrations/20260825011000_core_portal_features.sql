insert into public.platform_features(feature_key, available)
values
  ('portal.students', true),
  ('portal.staff', true),
  ('portal.attendance', true),
  ('portal.results', true),
  ('portal.fees', true)
on conflict (feature_key) do update set available = excluded.available;
