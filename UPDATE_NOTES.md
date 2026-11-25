# Что добавлено в этой версии

Чат: ответы, правка, закрепление, «в сети / был(а) в сети», «печатает / отправляет фото / файл», редактор групп.
Профиль: баннер скрывается, если не задан; плашка «Создатель»; перемотка трека.
Аккаунты: переключение между аккаунтами, удаление аккаунта.
Интро и мелкие правки анимаций. Веб-версия (Netlify) и постоянный ключ подписи APK.

## SQL (Supabase → SQL Editor), по порядку
1. supabase/chat_features.sql
2. supabase/badges.sql          (замени ТВОЙ_НИК на свой @ник без @)
3. supabase/group_update.sql

## Edge Functions (Supabase → Edge Functions)
- delete-account  (supabase/functions/delete-account/index.ts, Verify JWT включён)
- send-push       (если используешь пуши, см. PUSH_SETUP.md)

## GitHub
- Один раз запусти Actions → Make signing keystore и добавь 4 секрета (см. MOBILE_APK.md), чтобы APK ставился поверх.
- Веб-версия: см. WEB.md.
