import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";

/* Список аккаунтов, в которые выполнен вход на этом устройстве.
   Сессии лежат в localStorage так же, как собственная сессия Supabase. */

export type SavedAccount = {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  access_token: string;
  refresh_token: string;
};

const KEY = "tosto:accounts";
const EMPTY: SavedAccount[] = [];
const subs = new Set<() => void>();

function read(): SavedAccount[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as SavedAccount[]).filter((a) => a?.id && a.refresh_token) : [];
  } catch {
    return [];
  }
}

let cache: SavedAccount[] = read();

function write(next: SavedAccount[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // хранилище недоступно: список живёт до перезапуска
  }
  subs.forEach((fn) => fn());
}

export const listAccounts = () => cache;
export const getAccount = (id: string) => cache.find((a) => a.id === id);

/** Запоминает свежие токены сессии (вызывается при каждом входе и обновлении токена). */
export function saveSession(session: Session) {
  const id = session.user.id;
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const prev = getAccount(id);
  const fallbackName = String(meta.full_name ?? meta.name ?? session.user.email?.split("@")[0] ?? "Аккаунт");
  const entry: SavedAccount = {
    id,
    name: prev?.name ?? fallbackName,
    handle: prev?.handle ?? "",
    avatar_url: prev?.avatar_url ?? (typeof meta.avatar_url === "string" ? meta.avatar_url : null),
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  };
  write(prev ? cache.map((a) => (a.id === id ? entry : a)) : [...cache, entry]);
}

/** Имя, ник и аватар для списка (после загрузки или правки профиля). */
export function saveAccountInfo(id: string, info: { name: string; handle: string; avatar_url: string | null }) {
  const prev = getAccount(id);
  if (!prev) return;
  if (prev.name === info.name && prev.handle === info.handle && prev.avatar_url === info.avatar_url) return;
  write(cache.map((a) => (a.id === id ? { ...a, ...info } : a)));
}

export function removeAccount(id: string) {
  if (!getAccount(id)) return;
  write(cache.filter((a) => a.id !== id));
}

export function useAccounts(): SavedAccount[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => cache,
    () => EMPTY,
  );
}
