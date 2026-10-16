-- Deliver tenant-scoped notifications from communication and learning events.
create or replace function public.notify_conversation_message() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.portal_notifications(school_id,recipient_account_id,kind,title,body,href,resource_type,resource_id)
 select new.school_id,participant.user_id,'message','New message',left(new.body,240),'/messages','conversation',new.conversation_id::text
 from public.conversation_participants participant where participant.school_id=new.school_id and participant.conversation_id=new.conversation_id and participant.user_id<>new.sender_id;
 return new;
end$$;
create trigger messages_notify after insert on public.messages for each row execute function public.notify_conversation_message();

create or replace function public.notify_classroom_publication() returns trigger language plpgsql security definer set search_path='' as $$
declare _title text;_body text;_href text;_kind text;_actor uuid;begin
 if tg_table_name='classroom_stream_posts' then
  if new.kind<>'announcement' or new.status<>'published' or (tg_op='UPDATE' and old.status='published') then return new;end if;
  _title:=coalesce(new.title,'Class announcement');_body:=left(new.body,240);_href:='/classroom-stream';_kind:='announcement';_actor:=new.author_id;
 else
  if new.status<>'published' or (tg_op='UPDATE' and old.status='published') then return new;end if;
  _title:='New assignment: '||new.title;_body:=left(new.instructions,240);_href:='/learning';_kind:='assignment';_actor:=new.created_by;
 end if;
 insert into public.portal_notifications(school_id,recipient_account_id,kind,title,body,href,resource_type,resource_id)
 select new.school_id,coalesce(member.user_id,student.user_id),_kind,_title,_body,_href,tg_table_name,new.id::text
 from public.learning_classroom_memberships member left join public.students student on student.id=member.student_id and student.school_id=member.school_id
 where member.school_id=new.school_id and member.classroom_id=new.classroom_id and member.active and coalesce(member.user_id,student.user_id) is not null and coalesce(member.user_id,student.user_id)<>_actor;
 return new;
end$$;
create trigger stream_posts_notify after insert or update of status on public.classroom_stream_posts for each row execute function public.notify_classroom_publication();
create trigger assignments_notify after insert or update of status on public.assignments for each row execute function public.notify_classroom_publication();
revoke all on function public.notify_conversation_message(),public.notify_classroom_publication() from public;
