-- Repair production databases where conversation_participants predates read tracking.
-- The complete-platform workspace and message.read command both require this field.
alter table public.conversation_participants
  add column if not exists last_read_at timestamptz;

comment on column public.conversation_participants.last_read_at is
  'Most recent time the participant marked the conversation as read.';
