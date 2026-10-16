create table public.academic_subject_templates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  class_id uuid references public.classes(id) on delete cascade,
  arm_id uuid references public.class_arms(id) on delete cascade,
  subjects jsonb not null default '[]'::jsonb check (jsonb_typeof(subjects) = 'array'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name), unique (school_id, id),
  foreign key (school_id, class_id) references public.classes(school_id, id),
  foreign key (school_id, arm_id) references public.class_arms(school_id, id)
);
create index academic_subject_templates_scope_idx
  on public.academic_subject_templates(school_id, class_id, arm_id) where active;
create trigger academic_subject_templates_updated before update on public.academic_subject_templates
  for each row execute function public.set_updated_at();
create trigger academic_subject_templates_school_immutable before update on public.academic_subject_templates
  for each row execute function public.prevent_school_id_change();
alter table public.academic_subject_templates enable row level security;
create policy academic_subject_templates_read on public.academic_subject_templates
  for select to authenticated using(public.is_school_member(school_id));
create policy academic_subject_templates_manage on public.academic_subject_templates
  for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
grant select,insert,update,delete on public.academic_subject_templates to authenticated,service_role;
