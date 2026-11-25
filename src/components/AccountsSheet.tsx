import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Loader2, LogOut, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useAccounts } from "@/lib/accounts";
import { useBackHandler } from "@/lib/backStack";
import { UserAvatar } from "./UserAvatar";

/** Лист «Аккаунты»: переключение, добавление, выход и удаление аккаунта. */
export function AccountsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, profile, signInWithGoogle, signOut, switchAccount, deleteAccount } = useAuth();
  const accounts = useAccounts();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  useBackHandler(open, confirmDelete ? () => setConfirmDelete(false) : onClose, 30);

  const handle = profile?.handle ?? "";
  const canDelete = handle !== "" && typed.trim().replace(/^@/, "").toLowerCase() === handle.toLowerCase();

  async function pick(id: string) {
    if (busyId || id === user?.id) return;
    setBusyId(id);
    setError(null);
    const err = await switchAccount(id);
    if (err) setError(err);
    setBusyId(null);
    if (!err) onClose();
  }

  async function add() {
    setAdding(true);
    setError(null);
    const err = await signInWithGoogle({ chooseAccount: true });
    if (err) setError(err);
    setAdding(false);
  }

  async function remove() {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError(null);
    const err = await deleteAccount();
    setDeleting(false);
    if (err) {
      setError(err);
      return;
    }
    setConfirmDelete(false);
    setTyped("");
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="accounts"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => !deleting && onClose()}
        >
          <motion.div
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface-1 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:max-w-sm sm:rounded-3xl"
          >
            <div className="flex items-center justify-between px-5 pb-1 pt-4">
              <h2 className="font-display text-lg font-bold text-foreground">
                {confirmDelete ? "Удалить аккаунт" : "Аккаунты"}
              </h2>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => (confirmDelete && !deleting ? setConfirmDelete(false) : !deleting && onClose())}
                className="press flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!confirmDelete ? (
              <div className="px-2 pb-1">
                {accounts.map((a) => {
                  const active = a.id === user?.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => void pick(a.id)}
                      disabled={!!busyId}
                      className="tap flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left disabled:opacity-60"
                    >
                      <UserAvatar name={a.name} url={a.avatar_url} size="w-11 h-11" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-foreground">{a.name}</span>
                        {a.handle && <span className="block truncate text-[13px] text-muted-foreground">@{a.handle}</span>}
                      </span>
                      {busyId === a.id ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : active ? (
                        <Check className="h-5 w-5 text-pulse" />
                      ) : null}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={adding}
                  className="tap flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] font-medium text-foreground disabled:opacity-60"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-pulse">
                    {adding ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                  </span>
                  Добавить аккаунт
                </button>
              </div>
            ) : (
              <div className="px-5 pb-2 pt-1 text-[14px] leading-relaxed text-muted-foreground">
                <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Это действие необратимо. Восстановить аккаунт не получится.</span>
                </p>
                <p className="mt-3">Будут удалены: профиль, аватар и баннер, посты, комментарии, лайки, подписки, все ваши сообщения и вложения. Личные чаты исчезнут и у собеседника.</p>
                <p className="mt-3">Чтобы подтвердить, введите свой ник <span className="font-semibold text-foreground">@{handle}</span>:</p>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={handle}
                  className="mt-2 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none focus:border-pulse"
                />
              </div>
            )}

            {error && (
              <p role="alert" className="mx-5 mt-2 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <div className="mt-2 space-y-2 border-t border-border px-4 pt-3">
              {!confirmDelete ? (
                <>
                  <button
                    type="button"
                    onClick={() => void signOut().then(onClose)}
                    className="press flex w-full items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm font-semibold text-foreground"
                  >
                    <LogOut className="h-4 w-4" />
                    Выйти из этого аккаунта
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setTyped("");
                      setConfirmDelete(true);
                    }}
                    className="press flex w-full items-center justify-center gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Удалить аккаунт
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void remove()}
                    disabled={!canDelete || deleting}
                    className="press flex w-full items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Удалить навсегда
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="press w-full rounded-xl bg-surface-2 px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-50"
                  >
                    Отмена
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
