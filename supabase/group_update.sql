-- Tosto: редактирование групп (аватар, описание), роли участников, выход с передачей прав.
-- Выполнить один раз в Supabase → SQL Editor. Повторный запуск безопасен.

alter table public.chats
  add column if not exists avatar_url  text,
  add column if not exists description text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chats_description_len') then
    alter table public.chats
      add constraint chats_description_len check (description is null or char_length(description) <= 300);
  end if;
end $$;

-- Чтобы остальные участники сразу видели новое имя и аватар.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chats'
  ) then
    alter publication supabase_realtime add table public.chats;
  end if;
end $$;

-- ───────── Аватары групп ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-avatars', 'group-avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880;

drop policy if exists group_avatars_read   on storage.objects;
drop policy if exists group_avatars_insert on storage.objects;
drop policy if exists group_avatars_update on storage.objects;
drop policy if exists group_avatars_delete on storage.objects;

create policy group_avatars_read on storage.objects for select
  using (bucket_id = 'group-avatars');

-- Файлы лежат в папке <chat_id>/, менять их может только админ этой группы.
create policy group_avatars_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-avatars'
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
             then public.is_chat_admin(((storage.foldername(name))[1])::uuid) else false end
  );
create policy group_avatars_update on storage.objects for update to authenticated
  using (
    bucket_id = 'group-avatars'
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
             then public.is_chat_admin(((storage.foldername(name))[1])::uuid) else false end
  );
create policy group_avatars_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'group-avatars'
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
             then public.is_chat_admin(((storage.foldername(name))[1])::uuid) else false end
  );

-- ───────── Роли ─────────
create or replace function public.set_member_role(p_chat_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_role not in ('member', 'admin') then raise exception 'bad role'; end if;
  if not exists (select 1 from public.chats where id = p_chat_id and type = 'group') then
    raise exception 'not a group';
  end if;
  if not public.is_chat_admin(p_chat_id) then raise exception 'Только админ может менять роли'; end if;
  if p_role = 'member'
     and exists (select 1 from public.chat_members where chat_id = p_chat_id and user_id = p_user_id and role = 'admin')
     and (select count(*) from public.chat_members where chat_id = p_chat_id and role = 'admin') <= 1 then
    raise exception 'В группе должен остаться хотя бы один админ';
  end if;
  update public.chat_members set role = p_role where chat_id = p_chat_id and user_id = p_user_id;
  if not found then raise exception 'Участник не найден'; end if;
end;
$$;

-- ───────── Выход из группы ─────────
-- Если вышел последний админ, права получает самый давний участник; пустая группа удаляется.
create or replace function public.leave_group(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  heir uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.chats where id = p_chat_id and type = 'group') then
    raise exception 'not a group';
  end if;
  delete from public.chat_members where chat_id = p_chat_id and user_id = me;
  if not found then return; end if;

  if not exists (select 1 from public.chat_members where chat_id = p_chat_id) then
    delete from public.chats where id = p_chat_id;
  elsif not exists (select 1 from public.chat_members where chat_id = p_chat_id and role = 'admin') then
    select user_id into heir from public.chat_members where chat_id = p_chat_id order by joined_at limit 1;
    update public.chat_members set role = 'admin' where chat_id = p_chat_id and user_id = heir;
  end if;
end;
$$;

revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.leave_group(uuid) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
