insert into public.platform_features(feature_key, available)
values ('portal.academic', true)
on conflict (feature_key) do update set available = excluded.available;

insert into public.school_feature_entitlements(school_id, feature_key, entitled)
select school_id, 'portal.academic', true
from public.school_feature_entitlements
where feature_key = 'portal.students' and entitled
on conflict (school_id, feature_key) do update set entitled = excluded.entitled;
