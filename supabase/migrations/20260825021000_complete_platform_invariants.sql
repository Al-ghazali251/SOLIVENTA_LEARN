create or replace function public.validate_assignment_score() returns trigger language plpgsql set search_path=public as $$
declare maximum numeric;
begin select maximum_score into maximum from public.assignments where id=new.assignment_id and school_id=new.school_id;
 if new.score is not null and new.score>maximum then raise exception 'assignment score exceeds maximum' using errcode='23514'; end if; return new; end $$;
create trigger assignment_submission_score before insert or update on public.assignment_submissions for each row execute function public.validate_assignment_score();

create or replace function public.issue_library_loan(_school_id uuid,_book_id uuid,_borrower uuid,_due_at timestamptz,_actor uuid)
returns public.library_loans language plpgsql security definer set search_path='' as $$
declare book public.library_books; loan public.library_loans;
begin
 if not public.can_manage_school(_school_id,_actor) and not public.has_school_role(_school_id,array['librarian']::public.school_role[],_actor) then raise exception 'not authorized' using errcode='42501'; end if;
 select * into book from public.library_books where school_id=_school_id and id=_book_id for update;
 if book.id is null then raise exception 'book not found' using errcode='P0002'; end if;
 if book.available_copies<1 then raise exception 'no copy available' using errcode='23514'; end if;
 insert into public.library_loans(school_id,book_id,borrower_user_id,due_at,issued_by) values(_school_id,_book_id,_borrower,_due_at,_actor) returning * into loan;
 update public.library_books set available_copies=available_copies-1 where id=_book_id; return loan;
end $$;
create or replace function public.return_library_loan(_school_id uuid,_loan_id uuid,_actor uuid)
returns public.library_loans language plpgsql security definer set search_path='' as $$
declare loan public.library_loans;
begin
 if not public.can_manage_school(_school_id,_actor) and not public.has_school_role(_school_id,array['librarian']::public.school_role[],_actor) then raise exception 'not authorized' using errcode='42501'; end if;
 select * into loan from public.library_loans where school_id=_school_id and id=_loan_id for update;
 if loan.id is null then raise exception 'loan not found' using errcode='P0002'; end if;
 if loan.status='returned' then return loan; end if;
 update public.library_loans set status='returned',returned_at=now() where id=_loan_id returning * into loan;
 update public.library_books set available_copies=least(total_copies,available_copies+1) where school_id=_school_id and id=loan.book_id; return loan;
end $$;
revoke all on function public.issue_library_loan(uuid,uuid,uuid,timestamptz,uuid) from public;
revoke all on function public.return_library_loan(uuid,uuid,uuid) from public;
grant execute on function public.issue_library_loan(uuid,uuid,uuid,timestamptz,uuid),public.return_library_loan(uuid,uuid,uuid) to service_role;
