import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Camera, Check, Loader2, LogOut, Plus, Search, ShieldCheck, ShieldOff, Trash2, UserMinus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/untyped";
import { useBackHandler } from "@/lib/backStack";
import type { ChatItem, Profile } from "@/types";
import { UserAvatar } from "./UserAvatar";
import { ImageCropper } from "./ImageCropper";

const BUCKET = "group-avatars";

type Role = "member" | "admin";
export type GroupPatch = { name?: string | null; description?: string | null; avatar_url?: string | null; members?: Profile[] };

/** Экран группы: аватар, название, описание, участники и их роли. Правит админ, остальные только смотрят. */
export function GroupInfo({
  open,
  chat,
  meId,
  onClose,
  onChanged,
  onLeave,
}: {
  open: boolean;
  chat: ChatItem;
  meId: string;
  onClose: () => void;
  onChanged: (patch: GroupPatch) => void;
  onLeave: () => void;
}) {
  const chatId = chat.id;
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [name, setName] = useState(chat.name ?? "");
  const [desc, setDesc] = useState(chat.description ?? "");
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = roles[meId] === "admin";
  useBackHandler(open, cropFile ? () => setCropFile(null) : adding ? () => setAdding(false) : onClose, 35);

  // Каждый раз при открытии: свежие поля и роли.
  useEffect(() => {
    if (!open) return;
    setName(chat.name ?? "");
    setDesc(chat.description ?? "");
    setAvatarBlob(null);
    setAvatarPreview(null);
    setAvatarRemoved(false);
    setError(null);
    setSaved(false);
    setExpanded(null);
    setAdding(false);
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatId]);

  async function loadRoles() {
    const { data } = await db.from("chat_members").select("user_id, role").eq("chat_id", chatId);
    const map: Record<string, Role> = {};
    for (const r of (data ?? []) as { user_id: string; role: Role }[]) map[r.user_id] = r.role;
    setRoles(map);
  }

  const shownAvatar = avatarRemoved ? null : (avatarPreview ?? chat.avatar_url ?? null);
  const dirty =
    name.trim() !== (chat.name ?? "") ||
    desc.trim() !== (chat.description ?? "") ||
    !!avatarBlob ||
    avatarRemoved;

  const members = useMemo(
    () =>
      [...chat.members].sort((a, b) => {
        const ra = roles[a.id] === "admin" ? 0 : 1;
        const rb = roles[b.id] === "admin" ? 0 : 1;
        return ra - rb || a.display_name.localeCompare(b.display_name);
      }),
    [chat.members, roles],
  );

  async function save() {
    const cleanName = name.trim();
    const cleanDesc = desc.trim();
    if (!cleanName || cleanName.length > 60) return setError("Название: от 1 до 60 символов.");
    if (cleanDesc.length > 300) return setError("Описание не длиннее 300 символов.");
    setSaving(true);
    setError(null);
    try {
      let avatar_url: string | null = avatarRemoved ? null : (chat.avatar_url ?? null);
      if (avatarBlob) {
        const path = `${chatId}/${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, avatarBlob, { contentType: "image/jpeg", cacheControl: "3600" });
        if (upErr) throw new Error("Не удалось загрузить аватар: " + upErr.message);
        avatar_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
      if (avatarBlob || avatarRemoved) {
        // Старые аватарки не копим (не критично, если не получится).
        try {
          const { data: files } = await supabase.storage.from(BUCKET).list(chatId);
          const keep = avatar_url?.split("/").pop();
          const old = (files ?? []).filter((f) => f.name !== keep).map((f) => `${chatId}/${f.name}`);
          if (old.length) await supabase.storage.from(BUCKET).remove(old);
        } catch {
          /* ignore */
        }
      }
      const { error: updErr } = await db
        .from("chats")
        .update({ name: cleanName, description: cleanDesc || null, avatar_url })
        .eq("id", chatId);
      if (updErr) throw new Error(updErr.message);
      onChanged({ name: cleanName, description: cleanDesc || null, avatar_url });
      setAvatarBlob(null);
      setAvatarPreview(null);
      setAvatarRemoved(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function setRole(userId: string, role: Role) {
    setError(null);
    const { error: err } = await db.rpc("set_member_role", { p_chat_id: chatId, p_user_id: userId, p_role: role });
    if (err) return setError(err.message);
    setRoles((r) => ({ ...r, [userId]: role }));
    setExpanded(null);
  }

  async function kick(user: Profile) {
    if (!window.confirm(`Удалить ${user.display_name} из группы?`)) return;
    setError(null);
    const { error: err } = await db.from("chat_members").delete().eq("chat_id", chatId).eq("user_id", user.id);
    if (err) return setError(err.message);
    onChanged({ members: chat.members.filter((m) => m.id !== user.id) });
    setExpanded(null);
  }

  async function addMember(user: Profile) {
    setError(null);
    const { error: err } = await db.from("chat_members").insert({ chat_id: chatId, user_id: user.id });
    if (err) return setError(err.message);
    onChanged({ members: [...chat.members, user] });
    setRoles((r) => ({ ...r, [user.id]: "member" }));
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="group-info"
            className="fixed inset-0 z-[60] flex flex-col bg-background"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <div className="flex items-center gap-1 border-b border-border pb-2 pl-1 pr-3 pt-[calc(0.5rem+env(safe-area-inset-top))]">
              <button
                type="button"
                onClick={onClose}
                aria-label="Назад"
                className="press flex h-10 w-10 items-center justify-center rounded-full text-foreground"
              >
                <ArrowLeft className="h-[22px] w-[22px]" />
              </button>
              <h2 className="flex-1 font-display text-base font-semibold text-foreground">Группа</h2>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  className="press flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
                  {saved ? "Готово" : "Сохранить"}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              {/* Аватар */}
              <div className="flex flex-col items-center pt-6">
                <div className="relative">
                  <UserAvatar name={name || chat.name || "Группа"} url={shownAvatar} size="w-24 h-24" className="text-3xl" />
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      aria-label="Сменить фото группы"
                      className="press absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground"
                    >
                      <Camera className="h-[18px] w-[18px]" />
                    </button>
                  )}
                </div>
                {isAdmin && shownAvatar && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarBlob(null);
                      setAvatarPreview(null);
                      setAvatarRemoved(true);
                    }}
                    className="press mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Убрать фото
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) setCropFile(f);
                  }}
                />
              </div>

              {/* Название и описание */}
              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Название</span>
                  {isAdmin ? (
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value.slice(0, 60))}
                      className="mt-1.5 w-full rounded-xl border border-border bg-surface-1 px-3.5 py-2.5 text-[15px] text-foreground outline-none focus:border-pulse"
                    />
                  ) : (
                    <p className="mt-1.5 text-[16px] font-semibold text-foreground">{chat.name || "Группа"}</p>
                  )}
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Описание</span>
                  {isAdmin ? (
                    <>
                      <textarea
                        value={desc}
                        onChange={(e) => setDesc(e.target.value.slice(0, 300))}
                        rows={3}
                        placeholder="О чём эта группа"
                        className="mt-1.5 w-full resize-none rounded-xl border border-border bg-surface-1 px-3.5 py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-pulse"
                      />
                      <span className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground">{desc.length}/300</span>
                    </>
                  ) : (
                    <p className="mt-1.5 whitespace-pre-line break-words text-[15px] text-foreground/90">
                      {chat.description || <span className="text-muted-foreground">Описания нет</span>}
                    </p>
                  )}
                </label>
              </div>

              {error && (
                <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </p>
              )}

              {/* Участники */}
              <div className="mt-7 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Участники · {members.length}</h3>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="press flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-medium text-pulse"
                  >
                    <Plus className="h-4 w-4" /> Добавить
                  </button>
                )}
              </div>

              <div className="mt-2">
                {members.map((m) => {
                  const me = m.id === meId;
                  const admin = roles[m.id] === "admin";
                  const open = expanded === m.id;
                  return (
                    <div key={m.id} className="border-b border-border/60 last:border-0">
                      <button
                        type="button"
                        onClick={() => isAdmin && !me && setExpanded(open ? null : m.id)}
                        className="tap flex w-full items-center gap-3 py-2.5 text-left"
                      >
                        <UserAvatar name={m.display_name} url={m.avatar_url} size="w-11 h-11" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-foreground">
                            {m.display_name}
                            {me && <span className="font-normal text-muted-foreground"> · вы</span>}
                          </span>
                          <span className="block truncate text-[13px] text-muted-foreground">@{m.handle}</span>
                        </span>
                        {admin && (
                          <span className="flex items-center gap-1 rounded-full bg-pulse/15 px-2.5 py-0.5 text-xs font-medium text-pulse">
                            <ShieldCheck className="h-3.5 w-3.5" /> админ
                          </span>
                        )}
                      </button>
                      <AnimatePresence initial={false}>
                        {open && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="flex gap-2 pb-3 pl-14">
                              <button
                                type="button"
                                onClick={() => void setRole(m.id, admin ? "member" : "admin")}
                                className="press flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-foreground"
                              >
                                {admin ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4 text-pulse" />}
                                {admin ? "Снять админа" : "Сделать админом"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void kick(m)}
                                className="press flex items-center gap-1.5 rounded-full bg-destructive/10 px-3.5 py-2 text-[13px] font-medium text-destructive"
                              >
                                <UserMinus className="h-4 w-4" /> Удалить
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={onLeave}
                className="press mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
              >
                <LogOut className="h-4 w-4" /> Выйти из группы
              </button>
            </div>

            <AddMembers
              open={adding}
              existing={chat.members.map((m) => m.id)}
              onClose={() => setAdding(false)}
              onAdd={addMember}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {cropFile && (
        <ImageCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onDone={(blob) => {
            setAvatarBlob(blob);
            setAvatarPreview(URL.createObjectURL(blob));
            setAvatarRemoved(false);
            setCropFile(null);
          }}
        />
      )}
    </>
  );
}

/** Поиск людей и добавление в группу прямо из списка. */
function AddMembers({
  open,
  existing,
  onClose,
  onAdd,
}: {
  open: boolean;
  existing: string[];
  onClose: () => void;
  onAdd: (user: Profile) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
    const q = query.trim().replace(/^@+/, "").replace(/[%,()*\\]/g, "").trim();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      let req = supabase
        .from("profiles")
        .select("id, display_name, handle, avatar_url")
        .order("display_name")
        .limit(30);
      if (q) req = req.or(`display_name.ilike.%${q}%,handle.ilike.%${q}%`);
      const { data } = await req;
      setResults((data ?? []) as Profile[]);
      setSearching(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="add"
          className="absolute inset-0 z-10 flex flex-col bg-background"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 400, damping: 38 }}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface-1 px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Имя или @ник"
                className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <button type="button" onClick={onClose} aria-label="Закрыть" className="press flex h-10 w-10 items-center justify-center rounded-full text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-[env(safe-area-inset-bottom)]">
            {results.map((u) => {
              const inGroup = existing.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  disabled={inGroup || busyId === u.id}
                  onClick={async () => {
                    setBusyId(u.id);
                    await onAdd(u);
                    setBusyId(null);
                  }}
                  className="tap flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left disabled:opacity-60"
                >
                  <UserAvatar name={u.display_name} url={u.avatar_url} size="w-11 h-11" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-foreground">{u.display_name}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">@{u.handle}</span>
                  </span>
                  {inGroup ? (
                    <Check className="h-5 w-5 text-pulse" />
                  ) : busyId === u.id ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Plus className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
