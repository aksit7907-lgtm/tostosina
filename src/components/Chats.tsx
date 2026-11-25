import { haptic } from "@/lib/haptics";
import { useBackHandler } from "@/lib/backStack";
import { motion, AnimatePresence } from "framer-motion";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  PenSquare,
  Send,
  Paperclip,
  Mic,
  Image as ImageIcon,
  FileText,
  Loader2,
  Plus,
  X,
  ArrowLeft,
  Users,
  Check,
  User as UserIcon,
  ChevronDown,
  CheckCheck,
  Clock,
  Copy,
  Info,
  Pencil,
  Pin,
  PinOff,
  Reply,
} from "lucide-react";
import type { ChatItem, ChatRow, Message, Profile } from "@/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { playSound, typingSound } from "@/lib/sounds";
import { RichText } from "@/lib/mentions";
import { MAX_FILE_BYTES, compressImage, formatSize, previewOf, uploadChatMedia } from "@/lib/media";
import { MessageMedia } from "./MessageMedia";
import { VoiceRecorderBar } from "./VoiceRecorderBar";
import { UserAvatar, nameHue } from "./UserAvatar";
import { useEdgeSwipeBack } from "@/lib/swipeBack";
import { addUnread, clearUnread, useUnreadCounts } from "@/lib/unread";
import { useProfileViewer } from "@/lib/profileView";
import { db } from "@/lib/untyped";
import { RoleBadge } from "./RoleBadge";
import { GroupInfo, type GroupPatch } from "./GroupInfo";
import { lastSeenLabel, useOnlineIds, usePresence } from "@/lib/presence";
import { activityText, useChatActivity, type Activity } from "@/lib/activity";

function msgTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function chatTitle(chat: ChatItem, meId: string) {
  if (chat.type === "group") return chat.name || "Группа";
  const other = chat.members.find((m) => m.id !== meId);
  return other?.display_name ?? "Собеседник";
}

function chatAvatarUrl(chat: ChatItem, meId: string) {
  if (chat.type === "group") return chat.avatar_url ?? null;
  return chat.members.find((m) => m.id !== meId)?.avatar_url ?? null;
}

type MembershipRow = {
  chat_id: string;
  profiles: Profile | null;
};

/** Поля, добавленные миграцией supabase/chat_features.sql. */
type MessageX = Message & {
  reply_to_id?: string | null;
  edited_at?: string | null;
  pinned_at?: string | null;
};

const isTextMsg = (m: Message) => !m.kind || m.kind === "text";

function ActivityText({ text }: { text: string }) {
  return (
    <span>
      {text}
      <span className="typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/* ───────────── Меню сообщения: ответить, копировать, закрепить, изменить ───────────── */

function MessageMenu({
  m,
  mine,
  onClose,
  onReply,
  onEdit,
  onPin,
}: {
  m: MessageX | null;
  mine: boolean;
  onClose: () => void;
  onReply: (m: MessageX) => void;
  onEdit: (m: MessageX) => void;
  onPin: (m: MessageX) => void;
}) {
  useBackHandler(!!m, onClose, 26);
  const pinned = !!m?.pinned_at;
  const items = m
    ? [
        { key: "reply", label: "Ответить", icon: Reply, run: () => onReply(m) },
        ...(isTextMsg(m)
          ? [
              {
                key: "copy",
                label: "Копировать",
                icon: Copy,
                run: () => {
                  navigator.clipboard?.writeText(m.body).catch(() => undefined);
                },
              },
            ]
          : []),
        { key: "pin", label: pinned ? "Открепить" : "Закрепить", icon: pinned ? PinOff : Pin, run: () => onPin(m) },
        ...(mine && isTextMsg(m) ? [{ key: "edit", label: "Изменить", icon: Pencil, run: () => onEdit(m) }] : []),
      ]
    : [];
  return (
    <AnimatePresence>
      {m && (
        <motion.div
          key="menu"
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full overflow-hidden rounded-t-3xl border border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] sm:max-w-xs sm:rounded-3xl"
          >
            <p className="line-clamp-2 border-b border-border px-5 py-3 text-[13px] text-muted-foreground">
              {previewOf(m)}
            </p>
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={() => {
                  haptic("light");
                  onClose();
                  it.run();
                }}
                className="tap flex w-full items-center gap-3.5 px-5 py-3.5 text-[15px] text-foreground"
              >
                <it.icon className="h-[19px] w-[19px] text-pulse" />
                {it.label}
              </button>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────── Окно «Новый чат / Новая группа» ───────────── */

function NewChatModal({
  open,
  meId,
  onClose,
  onCreated,
}: {
  open: boolean;
  meId: string;
  onClose: () => void;
  onCreated: (chatId: string) => void;
}) {
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode("direct");
      setQuery("");
      setSelected([]);
      setGroupName("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim().replace(/^@+/, "").replace(/[%,()*\\]/g, "").trim();
    const timer = setTimeout(async () => {
      setSearching(true);
      let req = supabase
        .from("profiles")
        .select("id, display_name, handle, avatar_url")
        .neq("id", meId)
        .order("display_name")
        .limit(20);
      if (q) req = req.or(`display_name.ilike.%${q}%,handle.ilike.%${q}%`);
      const { data, error: searchError } = await req;
      if (searchError) setError("Не удалось выполнить поиск: " + searchError.message);
      setResults((data ?? []) as Profile[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open, meId]);

  async function openDirect(user: Profile) {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("create_direct_chat", {
      other_user: user.id,
    });
    setBusy(false);
    if (rpcError || !data) {
      setError(rpcError?.message ?? "Не удалось создать чат");
      return;
    }
    onCreated(data as string);
  }

  async function createGroup() {
    if (!groupName.trim() || selected.length === 0) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("create_group_chat", {
      group_name: groupName.trim(),
      member_ids: selected.map((u) => u.id),
    });
    setBusy(false);
    if (rpcError || !data) {
      setError(rpcError?.message ?? "Не удалось создать группу");
      return;
    }
    onCreated(data as string);
  }

  function toggle(user: Profile) {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user],
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full flex-col rounded-t-3xl border border-border bg-surface-1 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-sm sm:rounded-3xl"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-semibold text-foreground">Новый чат</h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1 p-1 rounded-xl bg-background border border-border mb-3">
              {(["direct", "group"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                    mode === m
                      ? "bg-surface-2 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "direct" ? <UserIcon className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                  {m === "direct" ? "Личный" : "Группа"}
                </button>
              ))}
            </div>

            {mode === "group" && (
              <>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value.slice(0, 60))}
                  placeholder="Название группы"
                  className="w-full mb-3 px-4 py-2.5 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-pulse/50 focus:ring-2 focus:ring-pulse/15 transition"
                />
                {selected.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {selected.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggle(u)}
                        className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-surface-2 border border-border text-xs text-foreground"
                      >
                        {u.display_name}
                        <X className="w-3 h-3 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="relative group mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-pulse transition-colors" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти по имени или @нику"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-pulse/50 focus:ring-2 focus:ring-pulse/15 transition"
              />
            </div>

            <div className="flex-1 min-h-[120px] overflow-y-auto -mx-1 px-1 space-y-1">
              {searching && results.length === 0 ? (
                <div className="flex justify-center py-6 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              ) : results.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">Никого не найдено</p>
              ) : (
                results.map((u) => {
                  const picked = selected.some((s) => s.id === u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      disabled={busy}
                      onClick={() => (mode === "direct" ? openDirect(u) : toggle(u))}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-surface-2 transition-colors text-left disabled:opacity-50"
                    >
                      <UserAvatar name={u.display_name} url={u.avatar_url} size="w-9 h-9" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{u.display_name}</p>
                        <p className="text-xs text-muted-foreground truncate">@{u.handle}</p>
                      </div>
                      {mode === "group" && picked && <Check className="w-4 h-4 text-pulse" />}
                    </button>
                  );
                })
              )}
            </div>

            {mode === "group" && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={createGroup}
                disabled={busy || !groupName.trim() || selected.length === 0}
                className="w-full mt-3 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-35 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Создать группу
              </motion.button>
            )}
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


const PAGE = 60;

function dayDiff(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((start(now) - start(d)) / 86400000);
}

function dayLabel(iso: string) {
  const diff = dayDiff(iso);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("ru-RU", sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" });
}

/** Время в списке чатов как в Telegram: сегодня часы, на неделе день недели, раньше дата. */
function listTime(iso: string) {
  const diff = dayDiff(iso);
  if (diff <= 0) return msgTime(iso);
  const d = new Date(iso);
  if (diff < 7) {
    const w = d.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "");
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/* ───────────── Строка списка чатов (как в Telegram) ───────────── */

const ChatListRow = memo(function ChatListRow({
  chat,
  meId,
  active,
  unread,
  online,
  typing,
  onOpen,
}: {
  chat: ChatItem;
  meId: string;
  active: boolean;
  unread: number;
  online: boolean;
  typing: string | null;
  onOpen: (id: string) => void;
}) {
  const title = chatTitle(chat, meId);
  return (
    <button
      type="button"
      onClick={() => onOpen(chat.id)}
      className={`tap w-full flex items-center gap-3 pl-4 h-[72px] text-left transition-colors ${
        active ? "sm:bg-pulse/10" : ""
      }`}
    >
      <span className="relative shrink-0">
        <UserAvatar name={title} url={chatAvatarUrl(chat, meId)} size="w-[54px] h-[54px]" className="text-base" />
        {online && (
          <span className="absolute bottom-0 right-0 h-[15px] w-[15px] rounded-full border-2 border-background bg-pulse" />
        )}
      </span>
      <div className="flex-1 min-w-0 self-stretch flex flex-col justify-center pr-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="flex-1 min-w-0 flex items-center gap-1.5 font-semibold text-[16px] text-foreground">
            {chat.type === "group" && <Users className="w-4 h-4 text-muted-foreground shrink-0" />}
            <span className="truncate">{title}</span>
          </span>
          {chat.last_message && (
            <span className={`text-[12px] shrink-0 tabular-nums ${unread ? "text-pulse" : "text-muted-foreground"}`}>
              {listTime(chat.last_message_at)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`flex-1 min-w-0 truncate text-[14px] ${typing ? "text-pulse" : "text-muted-foreground"}`}>
            {typing ? <ActivityText text={typing} /> : (chat.last_message ?? "Нет сообщений")}
          </span>
          {unread > 0 && (
            <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-pulse text-primary-foreground text-[12px] font-semibold flex items-center justify-center tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

function ChatListSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 pl-4 h-[72px]">
          <div className="skeleton w-[54px] h-[54px] rounded-full" />
          <div className="flex-1 pr-4 space-y-2">
            <div className="skeleton h-3.5 rounded-full" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
            <div className="skeleton h-3 rounded-full" style={{ width: `${55 + ((i * 23) % 35)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────── Сообщение ───────────── */

type BubbleProps = {
  m: MessageX;
  mine: boolean;
  isGroup: boolean;
  sender?: Profile;
  first: boolean;
  last: boolean;
  fresh: boolean;
  /** undefined: это не ответ; null: исходное сообщение ещё не загружено. */
  reply?: MessageX | null;
  replyName: string;
  flash: boolean;
  onMenu: (m: Message) => void;
  onReply: (m: Message) => void;
  onJump: (id: string) => void;
};

const Bubble = memo(function Bubble({
  m,
  mine,
  isGroup,
  sender,
  first,
  last,
  fresh,
  reply,
  replyName,
  flash,
  onMenu,
  onReply,
  onJump,
}: BubbleProps) {
  const isText = isTextMsg(m);
  const isImage = m.kind === "image";
  const pending = m.id.startsWith("tmp-");
  const senderName = sender?.display_name ?? "Участник";
  const metaTone = mine ? "text-primary-foreground/65" : "text-muted-foreground";
  const edited = !!m.edited_at;
  const pinned = !!m.pinned_at;
  const status = mine ? (
    pending ? <Clock className="h-3 w-3" /> : <CheckCheck className="h-3.5 w-3.5" />
  ) : null;
  const extras = (
    <>
      {pinned && <Pin className="h-3 w-3" />}
      {edited && <span>изм.</span>}
    </>
  );
  const spacer = (mine ? 68 : 50) + (edited ? 30 : 0) + (pinned ? 15 : 0);

  // Долгое нажатие открывает меню, свайп влево — ответ.
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const clearPress = () => {
    if (press.current) {
      window.clearTimeout(press.current.timer);
      press.current = null;
    }
  };
  useEffect(() => () => clearPress(), []);

  return (
    <div
      id={`msg-${m.id}`}
      className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"} ${first ? "mt-2" : "mt-0.5"} ${
        fresh ? "anim-pop-in" : ""
      }`}
      style={fresh ? { transformOrigin: mine ? "100% 100%" : "0% 100%" } : undefined}
    >
      {!mine && isGroup &&
        (last ? <UserAvatar name={senderName} url={sender?.avatar_url} size="w-8 h-8" /> : <div className="w-8 shrink-0" />)}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.4, right: 0 }}
        dragSnapToOrigin
        onDragStart={clearPress}
        onDragEnd={(_, info) => {
          if (info.offset.x < -56 && !pending) {
            haptic("light");
            onReply(m);
          }
        }}
        onPointerDown={(e) => {
          if (pending || (e.pointerType === "mouse" && e.button !== 0)) return;
          clearPress();
          press.current = {
            x: e.clientX,
            y: e.clientY,
            timer: window.setTimeout(() => {
              press.current = null;
              window.getSelection()?.removeAllRanges();
              onMenu(m);
            }, 420),
          };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) clearPress();
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        onContextMenu={(e) => {
          e.preventDefault();
          clearPress();
          if (!pending) onMenu(m);
        }}
        className={`relative max-w-[82%] sm:max-w-[70%] rounded-[18px] text-[15px] leading-[1.35] shadow-[0_1px_1px_rgba(0,0,0,0.18)] transition-shadow [-webkit-touch-callout:none] ${
          isImage ? "p-[3px]" : "px-3 py-1.5"
        } ${
          mine
            ? `bg-primary text-primary-foreground ${last ? "rounded-br-[5px]" : ""}`
            : `bg-surface-2 text-foreground ${last ? "rounded-bl-[5px]" : ""}`
        } ${pending ? "opacity-75" : ""} ${flash ? "ring-2 ring-pulse/70" : ""}`}
      >
        {!mine && isGroup && first && (
          <p className={`text-[13px] font-semibold mb-0.5 truncate ${isImage ? "px-2 pt-1" : ""}`} style={{ color: `oklch(0.78 0.13 ${nameHue(senderName)})` }}>
            {senderName}
          </p>
        )}
        {reply !== undefined && (
          <button
            type="button"
            onClick={() => m.reply_to_id && onJump(m.reply_to_id)}
            className={`mb-1 block w-full rounded-lg border-l-2 py-0.5 pl-2 pr-1.5 text-left text-[13px] leading-tight ${
              isImage ? "mx-1.5 mt-1 !w-[calc(100%-12px)]" : ""
            } ${mine ? "border-primary-foreground/70 bg-primary-foreground/10" : "border-pulse bg-pulse/10"}`}
          >
            <span className={`block truncate font-semibold ${mine ? "text-primary-foreground" : "text-pulse"}`}>
              {replyName}
            </span>
            <span className={`block truncate ${mine ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
              {reply ? previewOf(reply) : "Показать сообщение"}
            </span>
          </button>
        )}
        {isText ? (
          <>
            <p className="selectable whitespace-pre-line break-words">
              <RichText text={m.body} onPrimary={mine} />
              <span className="inline-block" style={{ width: spacer }} aria-hidden="true" />
            </p>
            <span className={`absolute right-2.5 bottom-1 flex items-center gap-1 text-[11px] tabular-nums ${metaTone}`}>
              {extras}
              {msgTime(m.created_at)}
              {status}
            </span>
          </>
        ) : isImage ? (
          <div className="relative">
            <MessageMedia m={m} mine={mine} />
            <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] tabular-nums text-white">
              {extras}
              {msgTime(m.created_at)}
              {status}
            </span>
          </div>
        ) : (
          <>
            <MessageMedia m={m} mine={mine} />
            <div className={`mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums ${metaTone}`}>
              {extras}
              {msgTime(m.created_at)}
              {status}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
});

type Row = { type: "day"; key: string; label: string } | { type: "msg"; m: Message; first: boolean; last: boolean };

function buildRows(list: Message[]): Row[] {
  const out: Row[] = [];
  const GAP = 5 * 60 * 1000;
  let prevDay = "";
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const t = new Date(m.created_at).getTime();
    const day = new Date(t).toDateString();
    if (day !== prevDay) {
      out.push({ type: "day", key: "d" + m.id, label: dayLabel(m.created_at) });
      prevDay = day;
    }
    const prev = list[i - 1];
    const next = list[i + 1];
    const joinsPrev =
      !!prev &&
      prev.sender_id === m.sender_id &&
      new Date(prev.created_at).toDateString() === day &&
      t - new Date(prev.created_at).getTime() < GAP;
    const joinsNext =
      !!next &&
      next.sender_id === m.sender_id &&
      new Date(next.created_at).toDateString() === day &&
      new Date(next.created_at).getTime() - t < GAP;
    out.push({ type: "msg", m, first: !joinsPrev, last: !joinsNext });
  }
  return out;
}

/* ───────────── Основной экран ───────────── */

export function Chats({
  onConversationChange,
  openChatId,
  onOpenedChat,
  visible = true,
}: {
  onConversationChange?: (open: boolean) => void;
  openChatId?: string | null;
  onOpenedChat?: () => void;
  /** Вкладка «Чаты» сейчас на экране. Экран остаётся смонтированным, чтобы чаты не перезагружались. */
  visible?: boolean;
} = {}) {
  const { user, profile: meProfile } = useAuth();
  const { openProfile } = useProfileViewer();
  const meId = user?.id ?? "";
  const meName = meProfile?.display_name ?? "Участник";
  const unreadCounts = useUnreadCounts();
  const onlineIds = useOnlineIds();

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [hasOlder, setHasOlder] = useState<Record<string, boolean>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);

  useEffect(() => {
    onConversationChange?.(mobileOpen);
    return () => onConversationChange?.(false);
  }, [mobileOpen, onConversationChange]);

  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  useBackHandler(creating, () => setCreating(false), 25);
  useBackHandler(mobileOpen && visible, () => setMobileOpen(false), 20);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<MessageX | null>(null);
  const [editing, setEditing] = useState<MessageX | null>(null);
  const [menuMsg, setMenuMsg] = useState<MessageX | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [pins, setPins] = useState<Record<string, MessageX[]>>({});
  const [pinIdx, setPinIdx] = useState(0);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);

  const chatsRef = useRef<ChatItem[]>([]);
  chatsRef.current = chats;
  const messagesRef = useRef(messagesByChat);
  messagesRef.current = messagesByChat;
  const hasOlderRef = useRef(hasOlder);
  hasOlderRef.current = hasOlder;
  const editingRef = useRef<MessageX | null>(null);
  editingRef.current = editing;
  const typingSentRef = useRef(0);
  const stateRef = useRef({ activeId, mobileOpen, visible });
  stateRef.current = { activeId, mobileOpen, visible };

  const paneRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const stickRef = useRef(true);
  const [showDown, setShowDown] = useState(false);
  const lastIdRef = useRef<string | null | undefined>(undefined);
  const keepOffsetRef = useRef<number | null>(null);

  useEdgeSwipeBack(paneRef, mobileOpen, () => setMobileOpen(false));

  const loadChats = useCallback(async () => {
    if (!meId) return;
    const { data: mine, error } = await supabase.from("chat_members").select("chat_id").eq("user_id", meId);
    if (error) {
      setLoading(false);
      return;
    }
    const ids = (mine ?? []).map((m) => m.chat_id);
    if (ids.length === 0) {
      setChats([]);
      setLoading(false);
      return;
    }
    const [chatRes, memberRes] = await Promise.all([
      supabase.from("chats").select("*").in("id", ids).order("last_message_at", { ascending: false }),
      supabase.from("chat_members").select("chat_id, profiles(id, display_name, handle, avatar_url)").in("chat_id", ids),
    ]);
    if (chatRes.error) {
      setLoading(false);
      return;
    }
    const membersByChat = new Map<string, Profile[]>();
    for (const row of (memberRes.data ?? []) as unknown as MembershipRow[]) {
      if (!row.profiles) continue;
      const list = membersByChat.get(row.chat_id) ?? [];
      list.push(row.profiles);
      membersByChat.set(row.chat_id, list);
    }
    const items: ChatItem[] = ((chatRes.data ?? []) as unknown as ChatRow[]).map((c) => ({
      ...c,
      members: membersByChat.get(c.id) ?? [],
    }));
    setChats(items);
    setLoading(false);
  }, [meId]);

  /** Последние сообщения диалога: открывается мгновенно, старые подгружаются по кнопке. */
  const loadMessages = useCallback(async (chatId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    if (error) return;
    const fresh = ((data ?? []) as Message[]).reverse();
    setMessagesByChat((prev) => {
      const old = prev[chatId] ?? [];
      const ids = new Set(fresh.map((m) => m.id));
      const oldest = fresh[0]?.created_at;
      const older = oldest ? old.filter((m) => !m.id.startsWith("tmp-") && !ids.has(m.id) && m.created_at < oldest) : [];
      const pending = old.filter((m) => m.id.startsWith("tmp-"));
      return { ...prev, [chatId]: [...older, ...fresh, ...pending] };
    });
    setHasOlder((prev) => (chatId in prev ? prev : { ...prev, [chatId]: (data ?? []).length === PAGE }));
  }, []);

  const loadOlder = useCallback(async () => {
    const chatId = stateRef.current.activeId;
    const first = chatId ? messagesRef.current[chatId]?.find((m) => !m.id.startsWith("tmp-")) : undefined;
    if (!chatId || !first) return;
    setLoadingOlder(true);
    const el = scrollerRef.current;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .lt("created_at", first.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const rows = ((data ?? []) as Message[]).reverse();
    if (el) keepOffsetRef.current = el.scrollHeight - el.scrollTop;
    setMessagesByChat((prev) => ({ ...prev, [chatId]: [...rows, ...(prev[chatId] ?? [])] }));
    setHasOlder((prev) => ({ ...prev, [chatId]: rows.length === PAGE }));
    setLoadingOlder(false);
  }, []);

  /** Добавить сообщение в диалог и поднять чат в списке. */
  const applyMessage = useCallback(
    (m: Message, animate = false) => {
      setMessagesByChat((prev) => {
        const current = prev[m.chat_id];
        if (!current || current.some((item) => item.id === m.id)) return prev;
        return { ...prev, [m.chat_id]: [...current, m] };
      });
      if (animate) setFreshId(m.id);
      if (!chatsRef.current.some((c) => c.id === m.chat_id)) {
        loadChats();
        return;
      }
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.id === m.chat_id);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], last_message: previewOf(m), last_message_at: m.created_at };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    },
    [loadChats],
  );

  /** Закреплённые сообщения диалога (могут быть старше загруженной страницы). */
  const loadPins = useCallback(async (chatId: string) => {
    const { data, error } = await db
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .not("pinned_at", "is", null)
      .order("pinned_at", { ascending: false })
      .limit(20);
    if (error) return;
    setPins((prev) => ({ ...prev, [chatId]: (data ?? []) as MessageX[] }));
  }, []);

  /** Сообщение изменилось (правка, закрепление): обновляем список, закрепы и превью в списке чатов. */
  const applyUpdate = useCallback((m: MessageX) => {
    setMessagesByChat((prev) => {
      const cur = prev[m.chat_id];
      if (!cur) return prev;
      let hit = false;
      const next = cur.map((x) => {
        if (x.id !== m.id) return x;
        hit = true;
        return { ...x, ...m };
      });
      return hit ? { ...prev, [m.chat_id]: next } : prev;
    });
    setPins((prev) => {
      const rest = (prev[m.chat_id] ?? []).filter((x) => x.id !== m.id);
      const list = m.pinned_at
        ? [m, ...rest].sort((a, b) => new Date(b.pinned_at!).getTime() - new Date(a.pinned_at!).getTime())
        : rest;
      return { ...prev, [m.chat_id]: list };
    });
    setChats((prev) =>
      prev.map((c) => (c.id === m.chat_id && c.last_message_at === m.created_at ? { ...c, last_message: previewOf(m) } : c)),
    );
  }, []);

  /** Прокрутка к сообщению (ответ, закреп); при необходимости подгружает историю. */
  const jumpTo = useCallback(
    async (id: string) => {
      const chatId = stateRef.current.activeId;
      if (!chatId) return;
      const has = () => !!messagesRef.current[chatId]?.some((x) => x.id === id);
      let tries = 0;
      while (!has() && hasOlderRef.current[chatId] && tries < 8) {
        await loadOlder();
        tries++;
        await new Promise((r) => setTimeout(r, 60));
      }
      const el = document.getElementById(`msg-${id}`);
      if (!el) {
        setSendError("Сообщение не найдено");
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlashId(id);
      window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1400);
    },
    [loadOlder],
  );

  const isViewing = useCallback((chatId: string) => {
    const st = stateRef.current;
    if (!st.visible || st.activeId !== chatId) return false;
    return st.mobileOpen || (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches);
  }, []);

  useEffect(() => {
    if (!meId) return;
    loadChats();
    // RLS отдаёт события только по чатам, где я участник.
    const channel = supabase
      .channel(`tosto-chats-${meId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as Message;
        if (m.sender_id !== meId) {
          playSound("receive");
          if (isViewing(m.chat_id)) haptic("light");
          else addUnread(m.chat_id);
        } else if (!m.kind || m.kind === "text") {
          // Своё текстовое сообщение уже показано сразу, ответ сервера его заменит.
          const pending = messagesRef.current[m.chat_id]?.some((x) => x.id.startsWith("tmp-") && x.body === m.body);
          if (pending) return;
        }
        applyMessage(m, true);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        applyUpdate(payload.new as MessageX);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chats" }, (payload) => {
        const c = payload.new as { id: string; name?: string | null; avatar_url?: string | null; description?: string | null };
        setChats((prev) =>
          prev.map((x) =>
            x.id === c.id ? { ...x, name: c.name ?? null, avatar_url: c.avatar_url ?? null, description: c.description ?? null } : x,
          ),
        );
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_members", filter: `user_id=eq.${meId}` },
        () => loadChats(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meId, loadChats, applyMessage, applyUpdate, isViewing]);

  useEffect(() => {
    if (activeId) {
      loadMessages(activeId);
      loadPins(activeId);
    }
  }, [activeId, loadMessages, loadPins]);

  // Сменили диалог: прокрутка начинается заново, с низа.
  useLayoutEffect(() => {
    lastIdRef.current = undefined;
    stickRef.current = true;
    setShowDown(false);
    if (editingRef.current) setDraft("");
    setEditing(null);
    setReplyTo(null);
    setPinIdx(0);
    setGroupInfoOpen(false);
  }, [activeId]);

  // Открыли диалог и смотрим на него: непрочитанных нет.
  useEffect(() => {
    if (activeId && visible && (mobileOpen || (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches))) {
      clearUnread(activeId);
    }
  }, [activeId, visible, mobileOpen, unreadCounts]);

  const messages = activeId ? (messagesByChat[activeId] ?? []) : [];

  // Подгрузили ранние сообщения: оставляем прокрутку на месте.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && keepOffsetRef.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffsetRef.current;
      keepOffsetRef.current = null;
    }
  }, [messages]);

  // Первое открытие: сразу вниз без анимации. Новое сообщение: плавно, если мы и так внизу или это своё.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !activeId) return;
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? null;
    if (lastIdRef.current === lastId) return;
    const firstLoad = lastIdRef.current === undefined || lastIdRef.current === null;
    lastIdRef.current = lastId;
    if (!last) return;
    if (firstLoad) el.scrollTop = el.scrollHeight;
    else if (last.sender_id === meId || stickRef.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, activeId, meId]);

  const chatIds = useMemo(() => chats.map((c) => c.id), [chats]);
  const { activity, sendActivity } = useChatActivity(chatIds, meId, meName);

  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  // «записывает голосовое…» пока идёт запись.
  useEffect(() => {
    if (!recording || !activeId) return;
    const chatId = activeId;
    sendActivity(chatId, "voice");
    const t = window.setInterval(() => sendActivity(chatId, "voice"), 3000);
    return () => {
      window.clearInterval(t);
      sendActivity(chatId, "stop");
    };
  }, [recording, activeId, sendActivity]);

  function notifyTyping(value: string) {
    if (!activeId || editing) return;
    if (!value.trim()) {
      if (typingSentRef.current) {
        typingSentRef.current = 0;
        sendActivity(activeId, "stop");
      }
      return;
    }
    const now = Date.now();
    if (now - typingSentRef.current > 3000) {
      typingSentRef.current = now;
      sendActivity(activeId, "typing");
    }
  }

  // Поле ввода растёт вместе с текстом, как в Telegram.
  useEffect(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 120) + "px";
  }, [draft, activeId]);

  /** Загружает вложение в хранилище и создаёт сообщение. */
  async function sendMedia(kind: "image" | "file" | "voice", blob: Blob, name: string, mime: string, duration?: number) {
    if (!activeId || !meId) return;
    setSendError(null);
    setUploading(kind === "voice" ? "Отправка голосового…" : kind === "image" ? "Отправка фото…" : "Отправка файла…");
    const chatId = activeId;
    const replyId = replyTo?.id ?? null;
    const act: Activity = kind === "image" ? "photo" : kind === "file" ? "file" : "voice";
    sendActivity(chatId, act);
    const actTimer = window.setInterval(() => sendActivity(chatId, act), 3000);
    try {
      const path = await uploadChatMedia(chatId, blob, name, mime);
      const { data, error } = await db
        .from("messages")
        .insert({
          chat_id: chatId,
          sender_id: meId,
          ...(replyId ? { reply_to_id: replyId } : {}),
          kind,
          body: "",
          media_path: path,
          media_name: name,
          media_mime: mime,
          media_size: blob.size,
          media_duration: duration ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      playSound("send");
      if (replyId) setReplyTo(null);
      applyMessage(data as Message, true);
    } catch (e) {
      playSound("error");
      setSendError("Не удалось отправить: " + (e instanceof Error ? e.message : "ошибка"));
    } finally {
      window.clearInterval(actTimer);
      sendActivity(chatId, "stop");
      setUploading(null);
    }
  }

  async function handlePicked(files: FileList | null, asPhoto: boolean) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setSendError(`Файл слишком большой: ${formatSize(file.size)}. Максимум ${formatSize(MAX_FILE_BYTES)}.`);
      return;
    }
    if (asPhoto && file.type.startsWith("image/")) {
      const c = await compressImage(file);
      await sendMedia("image", c.blob, c.name, c.mime);
    } else {
      await sendMedia("file", file, file.name || "file", file.type || "application/octet-stream");
    }
  }

  /** Сообщение появляется сразу, до ответа сервера; при ошибке возвращается в поле ввода. */
  async function send() {
    if (editing) {
      void saveEdit();
      return;
    }
    const text = draft.trim();
    if (!text || !activeId || !meId) return;
    const chatId = activeId;
    const reply = replyTo;
    const replyId = reply?.id ?? null;
    haptic("light");
    setDraft("");
    setReplyTo(null);
    setSendError(null);
    typingSentRef.current = 0;
    sendActivity(chatId, "stop");
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    applyMessage(
      {
        id: tmpId,
        chat_id: chatId,
        sender_id: meId,
        body: text,
        created_at: new Date().toISOString(),
        kind: "text",
        reply_to_id: replyId,
      } as Message,
      true,
    );
    const { data, error } = await db
      .from("messages")
      .insert({ chat_id: chatId, sender_id: meId, body: text, ...(replyId ? { reply_to_id: replyId } : {}) })
      .select()
      .single();
    if (error || !data) {
      setMessagesByChat((prev) => ({ ...prev, [chatId]: (prev[chatId] ?? []).filter((m) => m.id !== tmpId) }));
      setDraft((d) => d || text);
      if (reply) setReplyTo((r) => r ?? reply);
      setSendError(error?.message ?? "Не удалось отправить");
      playSound("error");
      return;
    }
    playSound("send");
    const real = data as Message;
    setMessagesByChat((prev) => {
      const cur = prev[chatId] ?? [];
      const next = cur.some((m) => m.id === real.id)
        ? cur.filter((m) => m.id !== tmpId)
        : cur.map((m) => (m.id === tmpId ? real : m));
      return { ...prev, [chatId]: next };
    });
  }

  /* ───── Ответ, редактирование, закрепление ───── */

  const startReply = useCallback((m: Message) => {
    if (m.id.startsWith("tmp-")) return;
    if (editingRef.current) setDraft("");
    setEditing(null);
    setReplyTo(m as MessageX);
    window.setTimeout(() => taRef.current?.focus(), 30);
  }, []);

  const startEdit = useCallback((m: MessageX) => {
    setReplyTo(null);
    setEditing(m);
    setDraft(m.body);
    window.setTimeout(() => taRef.current?.focus(), 50);
  }, []);

  function cancelContext() {
    if (editing) setDraft("");
    setEditing(null);
    setReplyTo(null);
  }

  async function saveEdit() {
    const target = editing;
    const text = draft.trim().slice(0, 4000);
    if (!target || !text) return;
    if (text === target.body) {
      cancelContext();
      return;
    }
    haptic("light");
    setEditing(null);
    setDraft("");
    const { error } = await db.rpc("edit_message", { p_message_id: target.id, p_body: text });
    if (error) {
      setEditing(target);
      setDraft(text);
      setSendError("Не удалось изменить: " + error.message);
      playSound("error");
      return;
    }
    applyUpdate({ ...target, body: text, edited_at: new Date().toISOString() });
  }

  const togglePin = useCallback(
    async (m: MessageX) => {
      const next = !m.pinned_at;
      const { error } = await db.rpc("set_message_pin", { p_message_id: m.id, p_pinned: next });
      if (error) {
        setSendError(`Не удалось ${next ? "закрепить" : "открепить"}: ${error.message}`);
        playSound("error");
        return;
      }
      applyUpdate({ ...m, pinned_at: next ? new Date().toISOString() : null });
    },
    [applyUpdate],
  );

  const openMenu = useCallback((m: Message) => {
    if (m.id.startsWith("tmp-")) return;
    haptic("light");
    setMenuMsg(m as MessageX);
  }, []);

  async function leaveGroup(chatId: string) {
    if (!window.confirm("Выйти из группы?")) return;
    // leave_group передаёт права админа, если вышел последний; без SQL-обновления выходим старым способом.
    let { error } = await db.rpc("leave_group", { p_chat_id: chatId });
    if (error) ({ error } = await supabase.from("chat_members").delete().eq("chat_id", chatId).eq("user_id", meId));
    if (error) {
      setSendError("Не удалось выйти из группы: " + error.message);
      return;
    }
    setGroupInfoOpen(false);
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    setActiveId(null);
    setMobileOpen(false);
  }

  async function handleCreated(chatId: string) {
    setCreating(false);
    await loadChats();
    setActiveId(chatId);
    setMobileOpen(true);
  }

  const openChat = useCallback((id: string) => {
    haptic("light");
    setActiveId(id);
    setMobileOpen(true);
  }, []);

  // Открыть диалог, созданный снаружи (например, кнопкой «Написать» на странице профиля).
  useEffect(() => {
    if (!openChatId) return;
    let cancelled = false;
    (async () => {
      await loadChats();
      if (cancelled) return;
      setActiveId(openChatId);
      setMobileOpen(true);
      onOpenedChat?.();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChatId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? chats.filter((c) => chatTitle(c, meId).toLowerCase().includes(q)) : chats;
  }, [chats, search, meId]);
  const activeChat = chats.find((c) => c.id === activeId);
  const memberById = useMemo(() => {
    const map = new Map<string, Profile>();
    activeChat?.members.forEach((m) => map.set(m.id, m));
    return map;
  }, [activeChat]);
  const rows = useMemo(() => buildRows(messages), [messages]);
  const otherMember = activeChat?.type === "direct" ? activeChat.members.find((m) => m.id !== meId) : undefined;
  const presence = usePresence(otherMember?.id);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m as MessageX])), [messages]);
  const pinList = activeId ? (pins[activeId] ?? []) : [];
  const pin = pinList.length ? pinList[Math.min(pinIdx, pinList.length - 1)] : undefined;
  const renderBubble = (m: MessageX, first: boolean, last: boolean) => {
    const rep = m.reply_to_id ? (byId.get(m.reply_to_id) ?? null) : undefined;
    const replyName = rep
      ? rep.sender_id === meId
        ? "Вы"
        : (memberById.get(rep.sender_id)?.display_name ?? "Участник")
      : "Сообщение";
    return (
      <Bubble
        key={m.id}
        m={m}
        mine={m.sender_id === meId}
        isGroup={activeChat?.type === "group"}
        sender={memberById.get(m.sender_id)}
        first={first}
        last={last}
        fresh={freshId === m.id}
        reply={rep}
        replyName={replyName}
        flash={flashId === m.id}
        onMenu={openMenu}
        onReply={startReply}
        onJump={jumpTo}
      />
    );
  };
  const headerActivity =
    activeChat && activeId
      ? activityText(Object.values(activity[activeId] ?? {}), activeChat.type === "group")
      : null;

  return (
    <div className="relative flex-1 flex h-full min-h-0 overflow-hidden">
      {/* Список чатов */}
      <div className="w-full sm:w-80 shrink-0 flex flex-col border-r border-border min-h-0 bg-background">
        <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-4 pb-2">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">Чаты</h2>
            <button
              type="button"
              onClick={() => {
                haptic("light");
                setCreating(true);
              }}
              aria-label="Новый чат"
              className="press w-10 h-10 -mr-1.5 rounded-full flex items-center justify-center text-foreground active:bg-surface-2"
            >
              <PenSquare className="w-[21px] h-[21px]" />
            </button>
          </div>
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск"
              className="w-full h-10 pl-10 pr-3 rounded-full bg-surface-2 text-[15px] text-foreground placeholder:text-muted-foreground transition-shadow focus:outline-none focus:ring-2 focus:ring-pulse/30"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-2">
          {loading ? (
            <ChatListSkeleton />
          ) : filtered.length === 0 ? (
            <div className="anim-fade-up py-16 text-center px-6">
              <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-pulse/10 text-pulse">
                <PenSquare className="h-7 w-7" />
              </span>
              <p className="text-foreground text-base font-medium mb-1">
                {search.trim() ? "Ничего не найдено" : "Чатов пока нет"}
              </p>
              {!search.trim() && (
                <p className="text-muted-foreground text-sm">
                  Нажмите на иконку справа сверху, найдите человека и начните диалог.
                </p>
              )}
            </div>
          ) : (
            filtered.map((c, i) => (
              <div key={c.id} className={i < 9 ? "stagger-in" : ""} style={{ ["--i" as string]: i }}>
                <ChatListRow
                  chat={c}
                  meId={meId}
                  active={activeId === c.id}
                  unread={unreadCounts[c.id] ?? 0}
                  online={c.type === "direct" && c.members.some((x) => x.id !== meId && onlineIds.has(x.id))}
                  typing={activityText(Object.values(activity[c.id] ?? {}), c.type === "group")}
                  onOpen={openChat}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Диалог: на телефоне выезжает справа поверх всего экрана, свайп от левого края возвращает назад */}
      <div
        ref={paneRef}
        className={`fixed inset-0 z-40 flex flex-col min-h-0 bg-background sm:static sm:z-auto sm:flex-1 sm:[transform:none] sm:visible transition-[transform,visibility] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
          mobileOpen ? "[transform:none] visible" : "[transform:translate3d(100%,0,0)] invisible"
        }`}
      >
        {activeChat ? (
          <>
            <div className="relative z-10 flex items-center gap-1 pl-1 pr-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:pt-2 border-b border-border noir-glass">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="К списку чатов"
                className="press sm:hidden w-10 h-10 rounded-full flex items-center justify-center text-foreground"
              >
                <ArrowLeft className="w-[22px] h-[22px]" />
              </button>
              <button
                type="button"
                disabled={!otherMember && activeChat.type !== "group"}
                onClick={() => (activeChat.type === "group" ? setGroupInfoOpen(true) : otherMember && openProfile(otherMember.id))}
                className="flex-1 min-w-0 flex items-center gap-3 text-left sm:pl-3 disabled:cursor-default"
              >
                <UserAvatar name={chatTitle(activeChat, meId)} url={chatAvatarUrl(activeChat, meId)} size="w-10 h-10" />
                <div className="flex-1 min-w-0">
                  <p className="flex items-center gap-1 font-semibold text-[16px] leading-tight text-foreground">
                    <span className="truncate">{chatTitle(activeChat, meId)}</span>
                    {otherMember && <RoleBadge userId={otherMember.id} compact />}
                  </p>
                  <p className="text-[13px] truncate">
                    {headerActivity ? (
                      <span className="text-pulse">
                        <ActivityText text={headerActivity} />
                      </span>
                    ) : activeChat.type === "group" ? (
                      <span className="text-muted-foreground">{activeChat.members.length} участн.</span>
                    ) : presence.online ? (
                      <span className="text-pulse">в сети</span>
                    ) : (
                      <span className="text-muted-foreground">{lastSeenLabel(presence.lastSeen)}</span>
                    )}
                  </p>
                </div>
              </button>
              {activeChat.type === "group" && (
                <button
                  type="button"
                  onClick={() => setGroupInfoOpen(true)}
                  aria-label="О группе"
                  className="press w-10 h-10 rounded-full text-muted-foreground flex items-center justify-center"
                >
                  <Info className="w-[20px] h-[20px]" />
                </button>
              )}
            </div>

            <AnimatePresence initial={false}>
              {pin && (
                <motion.div
                  key="pinbar"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-b border-border bg-background/95"
                >
                  <div className="flex items-center gap-1 pl-3 pr-1">
                    <button
                      type="button"
                      onClick={() => {
                        haptic("light");
                        void jumpTo(pin.id);
                        if (pinList.length > 1) setPinIdx((i) => (i + 1) % pinList.length);
                      }}
                      className="tap flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
                    >
                      <Pin className="h-4 w-4 shrink-0 text-pulse" />
                      <span className="min-w-0 flex-1 border-l-2 border-pulse pl-2.5">
                        <span className="block text-[12px] font-semibold leading-tight text-pulse">
                          Закреплённое сообщение{pinList.length > 1 ? ` #${Math.min(pinIdx, pinList.length - 1) + 1}` : ""}
                        </span>
                        <span className="block truncate text-[14px] leading-tight text-foreground/90">{previewOf(pin)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void togglePin(pin)}
                      aria-label="Открепить"
                      className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground"
                    >
                      <PinOff className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div
              ref={scrollerRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                const away = el.scrollHeight - el.scrollTop - el.clientHeight;
                stickRef.current = away < 160;
                setShowDown(away > 420);
              }}
              className="chat-bg flex-1 overflow-y-auto px-2.5 py-3"
            >
              {messages.length === 0 ? (
                <div className="anim-fade-up h-full flex flex-col items-center justify-center text-center">
                  <UserAvatar
                    name={chatTitle(activeChat, meId)}
                    url={chatAvatarUrl(activeChat, meId)}
                    size="w-20 h-20"
                    className="text-xl mb-4"
                  />
                  <p className="text-foreground font-medium">{chatTitle(activeChat, meId)}</p>
                  <p className="text-muted-foreground text-sm mt-1">Напишите первое сообщение, чтобы начать беседу.</p>
                </div>
              ) : (
                <>
                  {activeId && hasOlder[activeId] && (
                    <div className="flex justify-center pb-2">
                      <button
                        type="button"
                        onClick={loadOlder}
                        disabled={loadingOlder}
                        className="press px-4 py-2 rounded-full bg-surface-2 text-[13px] text-muted-foreground flex items-center gap-2"
                      >
                        {loadingOlder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Показать ранние сообщения
                      </button>
                    </div>
                  )}
                  {rows.map((r) =>
                    r.type === "day" ? (
                      <div key={r.key} className="flex justify-center my-3">
                        <span className="px-3 py-1 rounded-full bg-surface-2 text-[12px] text-muted-foreground">
                          {r.label}
                        </span>
                      </div>
                    ) : (
                      renderBubble(r.m as MessageX, r.first, r.last)
                    ),
                  )}
                </>
              )}
            </div>

            <div className="relative px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] bg-background/95 border-t border-border">
              <AnimatePresence>
                {showDown && (
                  <motion.button
                    key="down"
                    type="button"
                    aria-label="Вниз"
                    initial={{ opacity: 0, scale: 0.6, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.6, y: 10 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    onClick={() => {
                      haptic("light");
                      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
                    }}
                    className="absolute -top-14 right-3 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-2 text-foreground shadow-lg"
                  >
                    <ChevronDown className="h-5 w-5" />
                  </motion.button>
                )}
              </AnimatePresence>
              {sendError && <p className="mb-2 px-2 text-xs text-destructive">{sendError}</p>}
              {uploading && (
                <p className="mb-2 px-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {uploading}
                </p>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handlePicked(e.target.files, true);
                  e.target.value = "";
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  handlePicked(e.target.files, false);
                  e.target.value = "";
                }}
              />

              <AnimatePresence initial={false}>
                {(replyTo || editing) && (
                  <motion.div
                    key="ctx"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2.5 px-2 pb-2">
                      {editing ? (
                        <Pencil className="h-5 w-5 shrink-0 text-pulse" />
                      ) : (
                        <Reply className="h-5 w-5 shrink-0 text-pulse" />
                      )}
                      <div className="min-w-0 flex-1 border-l-2 border-pulse pl-2.5">
                        <p className="truncate text-[13px] font-semibold leading-tight text-pulse">
                          {editing
                            ? "Редактирование"
                            : `Ответ ${replyTo!.sender_id === meId ? "себе" : (memberById.get(replyTo!.sender_id)?.display_name ?? "")}`.trim()}
                        </p>
                        <p className="truncate text-[14px] leading-tight text-muted-foreground">
                          {previewOf((editing ?? replyTo)!)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={cancelContext}
                        aria-label="Отмена"
                        className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground"
                      >
                        <X className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {recording ? (
                <VoiceRecorderBar
                  onCancel={() => setRecording(false)}
                  onError={(msg) => setSendError(msg)}
                  onSend={(blob, mime, secs) => {
                    setRecording(false);
                    sendMedia("voice", blob, "voice." + (mime.includes("mp4") ? "m4a" : "webm"), mime.split(";")[0], secs);
                  }}
                />
              ) : (
                <div className="flex items-end gap-1.5">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        haptic("light");
                        setAttachOpen((v) => !v);
                      }}
                      aria-label="Прикрепить"
                      className="press w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground shrink-0"
                    >
                      <Paperclip className="w-[22px] h-[22px]" />
                    </button>
                    {attachOpen && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setAttachOpen(false)} />
                        <div
                          style={{ transformOrigin: "0% 100%" }}
                          className="anim-pop-in absolute bottom-12 left-0 z-40 w-44 rounded-2xl bg-surface-2 border border-border overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setAttachOpen(false);
                              photoInputRef.current?.click();
                            }}
                            className="tap w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground"
                          >
                            <ImageIcon className="w-4 h-4 text-pulse" />
                            Фото
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachOpen(false);
                              fileInputRef.current?.click();
                            }}
                            className="tap w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground"
                          >
                            <FileText className="w-4 h-4 text-pulse" />
                            Файл
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex items-end rounded-[22px] border border-transparent bg-surface-2 px-4 py-[9px] transition-colors focus-within:border-pulse/40">
                    <textarea
                      ref={taRef}
                      value={draft}
                      onChange={(e) => {
                        typingSound(draft, e.target.value);
                        setDraft(e.target.value.slice(0, 4000));
                        notifyTyping(e.target.value);
                      }}
                      onFocus={() => {
                        window.setTimeout(() => {
                          const el = scrollerRef.current;
                          if (el) el.scrollTop = el.scrollHeight;
                        }, 280);
                      }}
                      onKeyDown={(e) => {
                        // На телефоне Enter переносит строку, как в Telegram; на компьютере отправляет.
                        if (e.key === "Enter" && !e.shiftKey && !isTouch) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={1}
                      placeholder="Сообщение"
                      className="w-full bg-transparent text-[16px] leading-[1.3] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none max-h-[120px]"
                    />
                  </div>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {draft.trim() ? (
                      <motion.button
                        key="send"
                        type="button"
                        initial={{ scale: 0.4, rotate: -30, opacity: 0 }}
                        animate={{ scale: 1, rotate: 0, opacity: 1 }}
                        exit={{ scale: 0.4, rotate: 30, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 520, damping: 28 }}
                        whileTap={{ scale: 0.88 }}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={send}
                        aria-label="Отправить"
                        className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0"
                      >
                        <Send className="w-[18px] h-[18px]" />
                      </motion.button>
                    ) : (
                      <motion.button
                        key="mic"
                        type="button"
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.4, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 520, damping: 28 }}
                        whileTap={{ scale: 0.88 }}
                        onClick={() => {
                          setSendError(null);
                          setRecording(true);
                        }}
                        disabled={!!uploading}
                        aria-label="Записать голосовое"
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-muted-foreground disabled:opacity-35"
                      >
                        <Mic className="w-[22px] h-[22px]" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-surface-1 border border-border flex items-center justify-center text-muted-foreground mb-4">
              <PenSquare className="w-6 h-6" />
            </div>
            <p className="text-foreground font-medium">Выберите чат</p>
            <p className="text-muted-foreground text-sm mt-1">
              или найдите человека и создайте новый, чтобы начать общение.
            </p>
          </div>
        )}
      </div>

      {activeChat?.type === "group" && (
        <GroupInfo
          open={groupInfoOpen}
          chat={activeChat}
          meId={meId}
          onClose={() => setGroupInfoOpen(false)}
          onChanged={(patch: GroupPatch) =>
            setChats((prev) => prev.map((c) => (c.id === activeChat.id ? { ...c, ...patch } : c)))
          }
          onLeave={() => void leaveGroup(activeChat.id)}
        />
      )}
      <MessageMenu
        m={menuMsg}
        mine={menuMsg?.sender_id === meId}
        onClose={() => setMenuMsg(null)}
        onReply={startReply}
        onEdit={startEdit}
        onPin={(m) => void togglePin(m)}
      />
      <NewChatModal open={creating} meId={meId} onClose={() => setCreating(false)} onCreated={handleCreated} />
    </div>
  );
}
