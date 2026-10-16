-- Formal result lifecycle and core school finance adjustments.
create type public.result_workflow_status as enum ('draft','submitted','approved','released','reopened');
create type public.invoice_adjustment_kind as enum ('credit','debit');

create table public.result_workflows (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null,
  class_id uuid not null,
  status public.result_workflow_status not null default 'draft',
  submitted_by uuid references auth.users(id), submitted_at timestamptz,
  approved_by uuid references auth.users(id), approved_at timestamptz,
  released_by uuid references auth.users(id), released_at timestamptz,
  review_note text check (review_note is null or char_length(review_note)<=1000),
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,term_id,class_id), unique(school_id,id),
  foreign key(school_id,term_id) references public.academic_terms(school_id,id) on delete cascade,
  foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade
);

create table public.result_workflow_events (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  workflow_id uuid not null references public.result_workflows(id) on delete cascade,
  from_status public.result_workflow_status,
  to_status public.result_workflow_status not null,
  actor_id uuid not null references auth.users(id), note text,
  occurred_at timestamptz not null default now()
);

create table public.invoice_adjustments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  invoice_id uuid not null references public.fee_invoices(id) on delete restrict,
  kind public.invoice_adjustment_kind not null, amount_minor bigint not null check(amount_minor>0),
  reason text not null check(char_length(trim(reason)) between 3 and 500),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  reversed_at timestamptz, reversed_by uuid references auth.users(id), reversal_reason text,
  unique(school_id,id)
);

create index result_workflows_status_idx on public.result_workflows(school_id,status,term_id,class_id);
create index result_workflow_events_idx on public.result_workflow_events(school_id,workflow_id,occurred_at);
create index invoice_adjustments_invoice_idx on public.invoice_adjustments(school_id,invoice_id,created_at);
create trigger result_workflows_updated before update on public.result_workflows for each row execute function public.set_updated_at();
create trigger result_workflows_school_immutable before update on public.result_workflows for each row execute function public.prevent_school_id_change();

create or replace function public.result_score_is_editable(_school_id uuid,_assessment_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select rw.status in ('draft','reopened') from public.assessment_definitions a
    left join public.result_workflows rw on rw.school_id=a.school_id and rw.term_id=a.term_id and rw.class_id=a.class_id
    where a.school_id=_school_id and a.id=_assessment_id),true);
$$;
create or replace function public.enforce_result_score_editable() returns trigger language plpgsql set search_path='' as $$
begin
  if not public.result_score_is_editable(coalesce(new.school_id,old.school_id),coalesce(new.assessment_id,old.assessment_id)) then raise exception 'result workflow is locked' using errcode='23514'; end if;
  return coalesce(new,old);
end $$;
create trigger result_scores_workflow_lock before insert or update or delete on public.result_scores
for each row execute function public.enforce_result_score_editable();

alter table public.result_workflows enable row level security;
alter table public.result_workflow_events enable row level security;
alter table public.invoice_adjustments enable row level security;
create policy result_workflows_read on public.result_workflows for select to authenticated using(public.is_school_member(school_id));
create policy result_workflows_manage on public.result_workflows for all to authenticated using(public.is_school_staff(school_id)) with check(public.is_school_staff(school_id));
create policy result_events_read on public.result_workflow_events for select to authenticated using(public.is_school_member(school_id));
create policy result_events_write on public.result_workflow_events for insert to authenticated with check(public.is_school_staff(school_id));
create policy adjustments_read on public.invoice_adjustments for select to authenticated using(public.is_school_staff(school_id) or exists(select 1 from public.fee_invoices i where i.id=invoice_id and public.can_initiate_student_invoice(i.school_id,i.student_id)));
create policy adjustments_manage on public.invoice_adjustments for all to authenticated using(public.account_has_permission(auth.uid(),school_id,'fees.manage')) with check(public.account_has_permission(auth.uid(),school_id,'fees.manage'));
grant select,insert,update on public.result_workflows to authenticated;
grant select,insert on public.result_workflow_events to authenticated;
grant select,insert,update on public.invoice_adjustments to authenticated;
grant execute on function public.result_score_is_editable(uuid,uuid) to authenticated;
