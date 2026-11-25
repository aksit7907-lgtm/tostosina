import { useCallback, useRef, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";

export type Transform = { s: number; x: number; y: number };

type Options = {
  minScale: number;
  maxScale: number;
  /** Насколько можно сдвинуть картинку от центра при данном масштабе: |x| ≤ mx, |y| ≤ my. */
  bounds: (scale: number) => { mx: number; my: number };
  /** Применить трансформацию к элементу (animate: плавно, например при отпускании). */
  apply: (t: Transform, animate: boolean) => void;
  /** Масштаб по двойному касанию (если не задан, двойной тап не обрабатывается). */
  doubleTapScale?: number;
  /** Перетаскивание вниз при минимальном масштабе (закрытие просмотрщика). */
  onDismissDrag?: (dy: number, released: boolean) => void;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Жесты как в Telegram: перетаскивание, щипок двумя пальцами, колесо мыши, двойной тап.
 * Трансформация считается относительно центра сцены: translate(x, y) scale(s).
 */
export function usePanZoom(options: Options) {
  const opts = useRef(options);
  opts.current = options;

  const t = useRef<Transform>({ s: options.minScale, x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number } | null>(null);
  const prevMid = useRef<{ x: number; y: number } | null>(null);
  const travelled = useRef(0);
  const dragY = useRef(0);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);

  const commit = useCallback((next: Transform, animate = false) => {
    const o = opts.current;
    const s = clamp(next.s, o.minScale * 0.6, o.maxScale * 1.4);
    const { mx, my } = o.bounds(s);
    t.current = { s, x: clamp(next.x, -mx, mx), y: clamp(next.y, -my, my) };
    o.apply(t.current, animate);
  }, []);

  /** Масштаб с неподвижной точкой (fx, fy) относительно центра сцены. */
  const zoomAt = useCallback(
    (nextScale: number, fx: number, fy: number, animate = false) => {
      const o = opts.current;
      const cur = t.current;
      const s = clamp(nextScale, o.minScale * 0.6, o.maxScale * 1.4);
      const k = s / cur.s;
      commit({ s, x: fx - (fx - cur.x) * k, y: fy - (fy - cur.y) * k }, animate);
    },
    [commit],
  );

  const settle = useCallback(() => {
    const o = opts.current;
    const cur = t.current;
    if (cur.s < o.minScale || cur.s > o.maxScale) {
      commit({ ...cur, s: clamp(cur.s, o.minScale, o.maxScale) }, true);
    } else {
      commit(cur, true);
    }
  }, [commit]);

  const center = (e: { currentTarget: EventTarget & Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };

  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) {
      travelled.current = 0;
      dragY.current = 0;
    }
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      prevMid.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLElement>) => {
    const p = pts.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    travelled.current += Math.abs(dx) + Math.abs(dy);
    const o = opts.current;
    const { cx, cy } = center(e);

    if (pts.current.size >= 2 && pinch.current) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ratio = d / pinch.current.d;
      pinch.current.d = d;
      const cur = t.current;
      const s = clamp(cur.s * ratio, o.minScale * 0.6, o.maxScale * 1.4);
      const fx = mid.x - cx;
      const fy = mid.y - cy;
      const k = s / cur.s;
      const pm = prevMid.current ?? mid;
      prevMid.current = mid;
      commit({ s, x: fx - (fx - cur.x) * k + (mid.x - pm.x), y: fy - (fy - cur.y) * k + (mid.y - pm.y) });
      return;
    }

    if (pts.current.size === 1) {
      const cur = t.current;
      if (cur.s > o.minScale + 0.01) {
        commit({ s: cur.s, x: cur.x + dx, y: cur.y + dy });
      } else if (o.onDismissDrag) {
        dragY.current += dy;
        o.onDismissDrag(dragY.current, false);
      } else {
        commit({ s: cur.s, x: cur.x + dx, y: cur.y + dy });
      }
    }
  };

  const end = (e: RPointerEvent<HTMLElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    const wasSingle = pts.current.size === 1;
    pts.current.delete(e.pointerId);
    const o = opts.current;
    if (pts.current.size < 2) {
      pinch.current = null;
      prevMid.current = null;
    }
    if (pts.current.size > 0) return;

    if (dragY.current !== 0) {
      o.onDismissDrag?.(dragY.current, true);
      dragY.current = 0;
    }
    // Двойной тап: приближаем или возвращаем масштаб.
    if (wasSingle && travelled.current < 10 && o.doubleTapScale) {
      const now = Date.now();
      const prev = lastTap.current;
      const { cx, cy } = center(e);
      if (prev && now - prev.time < 320 && Math.hypot(prev.x - e.clientX, prev.y - e.clientY) < 30) {
        lastTap.current = null;
        const zoomed = t.current.s > o.minScale * 1.05;
        if (zoomed) commit({ s: o.minScale, x: 0, y: 0 }, true);
        else zoomAt(o.doubleTapScale, e.clientX - cx, e.clientY - cy, true);
        return;
      }
      lastTap.current = { time: now, x: e.clientX, y: e.clientY };
    }
    settle();
  };

  const onWheel = (e: RWheelEvent<HTMLElement>) => {
    const { cx, cy } = center(e);
    zoomAt(t.current.s * Math.exp(-e.deltaY * 0.0015), e.clientX - cx, e.clientY - cy);
  };

  return {
    transform: t,
    commit,
    zoomAt,
    reset: (animate = true) => commit({ s: opts.current.minScale, x: 0, y: 0 }, animate),
    bind: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onWheel },
  };
}
