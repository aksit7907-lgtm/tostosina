-- Tosto: «в сети», ответы, редактирование и закрепление сообщений.
-- Выполнить один раз в Supabase → SQL Editor.

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

alter table public.messages
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null,
  add column if not exists edited_at   timestamptz,
  add column if not exists pinned_at   timestamptz;

create index if not exists messages_chat_pinned_idx
  on public.messages (chat_id, pinned_at desc)
  where pinned_at is not null;

-- Обновляет «был в сети» у текущего пользователя.
create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

-- Редактировать можно только своё текстовое сообщение.
create or replace function public.edit_message(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Пустое сообщение';
  end if;
  update public.messages
     set body = left(trim(p_body), 4000),
         edited_at = now()
   where id = p_message_id
     and sender_id = auth.uid()
     and coalesce(kind, 'text') = 'text';
  if not found then
    raise exception 'Нельзя изменить это сообщение';
  end if;
end;
$$;

-- Закрепить/открепить может любой участник чата.
create or replace function public.set_message_pin(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages m
     set pinned_at = case when p_pinned then now() else null end
   where m.id = p_message_id
     and exists (
       select 1 from public.chat_members cm
        where cm.chat_id = m.chat_id and cm.user_id = auth.uid()
     );
  if not found then
    raise exception 'Нет доступа к сообщению';
  end if;
end;
$$;

grant execute on function public.touch_presence()                   to authenticated;
grant execute on function public.edit_message(uuid, text)           to authenticated;
grant execute on function public.set_message_pin(uuid, boolean)     to authenticated;
