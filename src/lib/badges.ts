import { useEffect, useSyncExternalStore } from "react";
import { db } from "@/lib/untyped";

/* Плашки аккаунтов из таблицы profile_badges. Кэшируются, запросы по id склеиваются в один. */

const cache = new Map<string, string | null>();
const queue = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let scheduled = false;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

async function flush() {
  scheduled = false;
  const ids = [...queue];
  queue.clear();
  if (!ids.length) return;
  const { data, error } = await db.from("profile_badges").select("user_id, badge").in("user_id", ids);
  const found = new Map<string, string>();
  if (!error) for (const r of (data ?? []) as { user_id: string; badge: string }[]) found.set(r.user_id, r.badge);
  // При ошибке (например, таблицы ещё нет) считаем, что плашки нет.
  for (const id of ids) cache.set(id, found.get(id) ?? null);
  version++;
  listeners.forEach((l) => l());
}

export function useBadge(userId?: string | null): string | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    if (!userId || cache.has(userId) || queue.has(userId)) return;
    queue.add(userId);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => void flush());
    }
  }, [userId]);
  return userId ? (cache.get(userId) ?? null) : null;
}
