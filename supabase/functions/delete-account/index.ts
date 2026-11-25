// Edge Function: безвозвратно удаляет аккаунт того, кто её вызвал.
// 1) чистит файлы в Storage (аватар, баннер, вложения), 2) удаляет личные чаты и опустевшие группы,
// 3) удаляет пользователя в Auth: посты, комментарии, лайки, подписки, сообщения уходят каскадом.
// Вызывается из приложения с токеном пользователя (Verify JWT должен быть включён).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/** Удаляет все файлы папки <folder>/ в бакете. */
async function purgeFolder(bucket: string, folder: string) {
  for (let i = 0; i < 20; i++) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
    if (error || !data?.length) return;
    const paths = data.filter((f) => f.id).map((f) => `${folder}/${f.name}`);
    if (!paths.length) return;
    await admin.storage.from(bucket).remove(paths);
    if (data.length < 1000) return;
  }
}

async function removePaths(bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !auth?.user) return json({ error: "Не авторизован" }, 401);
    const uid = auth.user.id;

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "DELETE") return json({ error: "Нет подтверждения" }, 400);

    // Аватар и баннер лежат в папках <user_id>/
    await purgeFolder("avatars", uid);
    await purgeFolder("banners", uid);

    // Вложения, которые человек отправлял в чаты
    const { data: media } = await admin
      .from("messages")
      .select("media_path")
      .eq("sender_id", uid)
      .not("media_path", "is", null);
    await removePaths("chat-media", (media ?? []).map((m) => m.media_path as string).filter(Boolean));

    // Личные чаты исчезают целиком; группы, где никого не осталось, тоже
    const { data: memberships } = await admin.from("chat_members").select("chat_id").eq("user_id", uid);
    const chatIds = (memberships ?? []).map((m) => m.chat_id as string);
    if (chatIds.length) {
      const { data: chats } = await admin.from("chats").select("id, type").in("id", chatIds);
      for (const chat of chats ?? []) {
        let drop = chat.type === "direct";
        if (!drop) {
          const { count } = await admin
            .from("chat_members")
            .select("user_id", { count: "exact", head: true })
            .eq("chat_id", chat.id)
            .neq("user_id", uid);
          drop = (count ?? 0) === 0;
        }
        if (drop) {
          await purgeFolder("chat-media", chat.id as string);
          await admin.from("chats").delete().eq("id", chat.id);
        }
      }
    }

    const { error: delError } = await admin.auth.admin.deleteUser(uid);
    if (delError) return json({ error: `Не удалось удалить аккаунт: ${delError.message}` }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Ошибка сервера" }, 500);
  }
});
