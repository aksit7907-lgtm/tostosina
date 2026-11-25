import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/* «Печатает…», «отправляет фото…», «отправляет файл…» — через Realtime Broadcast, в базу ничего не пишется. */

export type Activity = "typing" | "photo" | "file" | "voice";
export type ActivityEntry = { name: string; kind: Activity; until: number };
type Slot = { ch: RealtimeChannel; ready: boolean };

const TTL = 6000;
const MAX_CHANNELS = 40;

const LABEL: Record<Activity, string> = {
  typing: "печатает",
  photo: "отправляет фото",
  file: "отправляет файл",
  voice: "записывает голосовое",
};

export function activityText(list: ActivityEntry[], isGroup: boolean): string | null {
  if (list.length === 0) return null;
  if (!isGroup) return LABEL[list[0].kind];
  if (list.length === 1) return `${list[0].name} ${LABEL[list[0].kind]}`;
  const names = list.slice(0, 2).map((e) => e.name).join(", ");
  const more = list.length - 2;
  return `${names}${more > 0 ? ` и ещё ${more}` : ""} печатают`;
}

export function useChatActivity(chatIds: string[], meId: string, meName: string) {
  const [map, setMap] = useState<Record<string, Record<string, ActivityEntry>>>({});
  const slots = useRef(new Map<string, Slot>());
  const key = chatIds.slice(0, MAX_CHANNELS).join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    const cur = slots.current;
    for (const [id, s] of cur) {
      if (!ids.includes(id)) {
        supabase.removeChannel(s.ch);
        cur.delete(id);
      }
    }
    for (const id of ids) {
      if (cur.has(id)) continue;
      const ch = supabase.channel(`activity:${id}`, { config: { broadcast: { self: false } } });
      const slot: Slot = { ch, ready: false };
      ch.on("broadcast", { event: "activity" }, ({ payload }) => {
        const p = payload as { userId?: string; name?: string; kind?: Activity | "stop" };
        if (!p?.userId || p.userId === meId) return;
        setMap((prev) => {
          const inner = { ...(prev[id] ?? {}) };
          if (p.kind === "stop" || !p.kind) delete inner[p.userId!];
          else inner[p.userId!] = { name: p.name || "Участник", kind: p.kind, until: Date.now() + TTL };
          return { ...prev, [id]: inner };
        });
      }).subscribe((status) => {
        slot.ready = status === "SUBSCRIBED";
      });
      cur.set(id, slot);
    }
  }, [key, meId]);

  useEffect(() => {
    const cur = slots.current;
    return () => {
      for (const s of cur.values()) supabase.removeChannel(s.ch);
      cur.clear();
    };
  }, []);

  // Если человек пропал, не прислав «stop», индикатор гаснет сам.
  useEffect(() => {
    const t = window.setInterval(() => {
      setMap((prev) => {
        const now = Date.now();
        let changed = false;
        const next: typeof prev = {};
        for (const [chatId, inner] of Object.entries(prev)) {
          const kept: Record<string, ActivityEntry> = {};
          for (const [uid, e] of Object.entries(inner)) {
            if (e.until > now) kept[uid] = e;
            else changed = true;
          }
          if (Object.keys(kept).length) next[chatId] = kept;
          else if (Object.keys(inner).length) changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const send = useCallback(
    (chatId: string, kind: Activity | "stop") => {
      const s = slots.current.get(chatId);
      if (!s?.ready || !meId) return;
      void s.ch.send({ type: "broadcast", event: "activity", payload: { userId: meId, name: meName, kind } });
    },
    [meId, meName],
  );

  return { activity: map, sendActivity: send };
}
