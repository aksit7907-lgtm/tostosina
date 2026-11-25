import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/untyped";

/* «В сети» считается по Realtime Presence (мгновенно), «был в сети» хранится в profiles.last_seen_at. */

const online = new Set<string>();
const leftAt = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function touch() {
  void db.rpc("touch_presence").then(
    () => undefined,
    () => undefined,
  );
}

/** Запускается один раз после входа. Возвращает функцию остановки. */
export function startPresence(meId: string) {
  const channel = supabase.channel("tosto-presence", { config: { presence: { key: meId } } });
  let tracked = false;

  const goOnline = async () => {
    if (tracked) return;
    tracked = true;
    await channel.track({ at: Date.now() });
    touch();
  };
  const goOffline = async () => {
    if (!tracked) return;
    tracked = false;
    await channel.untrack();
    touch();
  };
  const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

  channel
    .on("presence", { event: "sync" }, () => {
      const keys = new Set(Object.keys(channel.presenceState()));
      for (const id of online) if (!keys.has(id)) leftAt.set(id, Date.now());
      online.clear();
      keys.forEach((k) => online.add(k));
      emit();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED" && isVisible()) void goOnline();
    });

  const onVisibility = () => void (isVisible() ? goOnline() : goOffline());
  const onHide = () => void goOffline();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onHide);
  const heartbeat = window.setInterval(() => {
    if (tracked) touch();
  }, 60_000);

  return () => {
    window.clearInterval(heartbeat);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onHide);
    void goOffline();
    supabase.removeChannel(channel);
  };
}

/** Множество id людей, которые сейчас в сети. Компонент перерисовывается при изменениях. */
export function useOnlineIds(): ReadonlySet<string> {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return online;
}

/** Статус одного человека: в сети или время последнего визита. */
export function usePresence(userId?: string | null) {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const isOn = !!userId && online.has(userId);
  const [seen, setSeen] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!userId || isOn) return;
    let cancelled = false;
    db.from("profiles")
      .select("last_seen_at")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setSeen((data as { last_seen_at?: string | null } | null)?.last_seen_at ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isOn]);

  // Подпись «5 мин. назад» обновляется сама.
  useEffect(() => {
    if (isOn) return;
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [isOn]);

  const left = userId ? leftAt.get(userId) : undefined;
  const lastSeen = left ? new Date(left).toISOString() : seen;
  return { online: isOn, lastSeen };
}

/** «был(а) в сети 5 мин. назад», «сегодня в 14:05», «вчера в 14:05», «12 нояб. в 14:05». */
export function lastSeenLabel(iso: string | null): string {
  if (!iso) return "не в сети";
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "был(а) в сети только что";
  if (min < 60) return `был(а) в сети ${min} мин. назад`;
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff <= 0) return `был(а) в сети сегодня в ${time}`;
  if (diff === 1) return `был(а) в сети вчера в ${time}`;
  const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  return `был(а) в сети ${date} в ${time}`;
}
