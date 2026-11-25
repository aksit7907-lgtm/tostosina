-- Плашки аккаунтов («Создатель»). Выдаются только отсюда, из SQL Editor:
-- у обычных пользователей нет прав писать в таблицу, поэтому подделать плашку нельзя.

create table if not exists public.profile_badges (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  badge      text not null check (badge in ('creator')),
  created_at timestamptz not null default now()
);

alter table public.profile_badges enable row level security;

drop policy if exists "badges readable by everyone" on public.profile_badges;
create policy "badges readable by everyone"
  on public.profile_badges for select
  using (true);

revoke insert, update, delete on public.profile_badges from anon, authenticated;
grant select on public.profile_badges to anon, authenticated;

-- ▼ Подставь СВОЙ @ник (без @) и выполни. Повторный запуск безопасен.
insert into public.profile_badges (user_id, badge)
select id, 'creator' from public.profiles where handle = 'ТВОЙ_НИК'
on conflict (user_id) do update set badge = excluded.badge;
