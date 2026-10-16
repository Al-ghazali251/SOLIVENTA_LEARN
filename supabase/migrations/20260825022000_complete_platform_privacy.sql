-- Milestone 4 privacy hardening. Private conversations are visible only to
-- participants (or authorized school/platform administrators), and exam answer
-- keys remain server-side for learners.

drop policy if exists conversations_read on public.conversations;
drop policy if exists conversation_participants_read on public.conversation_participants;
drop policy if exists participants_manage on public.conversation_participants;
drop policy if exists messages_read on public.messages;
drop policy if exists messages_create on public.messages;
drop policy if exists exam_questions_read on public.exam_questions;

create policy conversations_read_participant
on public.conversations for select to authenticated
using (
  public.can_manage_school(school_id)
  or public.is_platform_moderator()
  or exists (
    select 1 from public.conversation_participants participant
    where participant.school_id = conversations.school_id
      and participant.conversation_id = conversations.id
      and participant.user_id = auth.uid()
  )
);

create policy conversation_participants_read_participant
on public.conversation_participants for select to authenticated
using (
  public.can_manage_school(school_id)
  or public.is_platform_moderator()
  or user_id = auth.uid()
);

create policy conversation_participants_insert_authorized
on public.conversation_participants for insert to authenticated
with check (
  public.can_manage_school(school_id)
  or exists (
    select 1 from public.conversations conversation
    where conversation.school_id = conversation_participants.school_id
      and conversation.id = conversation_participants.conversation_id
      and conversation.created_by = auth.uid()
  )
);

create policy conversation_participants_update_self
on public.conversation_participants for update to authenticated
using (public.can_manage_school(school_id) or user_id = auth.uid())
with check (public.can_manage_school(school_id) or user_id = auth.uid());

create policy conversation_participants_delete_authorized
on public.conversation_participants for delete to authenticated
using (
  public.can_manage_school(school_id)
  or exists (
    select 1 from public.conversations conversation
    where conversation.school_id = conversation_participants.school_id
      and conversation.id = conversation_participants.conversation_id
      and conversation.created_by = auth.uid()
  )
);

create policy messages_read_participant
on public.messages for select to authenticated
using (
  public.can_manage_school(school_id)
  or public.is_platform_moderator()
  or exists (
    select 1 from public.conversation_participants participant
    where participant.school_id = messages.school_id
      and participant.conversation_id = messages.conversation_id
      and participant.user_id = auth.uid()
  )
);

create policy messages_create_participant
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversation_participants participant
    where participant.school_id = messages.school_id
      and participant.conversation_id = messages.conversation_id
      and participant.user_id = auth.uid()
  )
);

create policy exam_questions_read_managers
on public.exam_questions for select to authenticated
using (
  public.is_platform_moderator()
  or public.has_school_role(
    school_id,
    array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]
  )
);
