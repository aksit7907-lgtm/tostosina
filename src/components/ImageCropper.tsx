import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { usePanZoom } from "@/lib/usePanZoom";
import { useBackHandler } from "@/lib/backStack";

const OUT = 512;

/**
 * Выбор области для аватарки как в Telegram: круглая рамка, картинку можно двигать,
 * приближать щипком, колесом или ползунком. Результат: квадратный JPEG 512×512.
 */
export function ImageCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useBackHandler(true, onCancel, 75);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState(300);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fit = () => setBox(Math.round(Math.min(window.innerWidth - 32, window.innerHeight - 260, 380)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Минимальный масштаб: картинка целиком закрывает рамку.
  const base = natural ? Math.max(box / natural.w, box / natural.h) : 1;

  const pz = usePanZoom({
    minScale: base,
    maxScale: base * 6,
    doubleTapScale: base * 2.2,
    bounds: (s) => {
      if (!natural) return { mx: 0, my: 0 };
      return { mx: Math.max(0, (natural.w * s - box) / 2), my: Math.max(0, (natural.h * s - box) / 2) };
    },
    apply: (t, animate) => {
      const el = imgRef.current;
      if (!el) return;
      el.style.transition = animate ? "transform 0.2s cubic-bezier(0.23,1,0.32,1)" : "none";
      el.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.s})`;
      setZoom(Math.min(1, Math.max(0, (t.s / base - 1) / 5)));
    },
  });

  // Когда известны размеры, ставим картинку по центру.
  useEffect(() => {
    if (natural) pz.commit({ s: base, x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, base]);

  const onSlider = useCallback(
    (v: number) => {
      pz.zoomAt(base * (1 + v * 5), 0, 0);
    },
    [pz, base],
  );

  async function save() {
    const img = imgRef.current;
    if (!img || !natural || busy) return;
    setBusy(true);
    try {
      const { s, x, y } = pz.transform.current;
      // Левый верхний угол рамки в координатах исходной картинки.
      const sx = natural.w / 2 - (box / 2 + x) / s;
      const sy = natural.h / 2 - (box / 2 + y) / s;
      const side = box / s;
      const canvas = document.createElement("canvas");
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, 0, 0, OUT, OUT);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", 0.9),
      );
      onDone(blob);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="anim-fade fixed inset-0 z-[80] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Выбор области аватара">
      <div className="flex items-center gap-2 px-2 pb-2 pt-[calc(0.625rem+env(safe-area-inset-top))] text-white">
        <button type="button" onClick={onCancel} aria-label="Отмена" className="press flex h-10 w-10 items-center justify-center rounded-full">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="flex-1 font-display text-base font-semibold">Масштаб и положение</h3>
        <button
          type="button"
          onClick={save}
          disabled={!natural || busy}
          className="press flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-pulse disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Готово
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
        <div
          className="relative touch-none select-none overflow-hidden bg-black"
          style={{ width: box, height: box, borderRadius: 24 }}
          {...pz.bind}
        >
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img
            ref={imgRef}
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
            className="absolute left-1/2 top-1/2 max-w-none will-change-transform"
            style={
              natural
                ? { width: natural.w, height: natural.h, marginLeft: -natural.w / 2, marginTop: -natural.h / 2, transformOrigin: "center" }
                : { opacity: 0 }
            }
          />
          {/* Круглая рамка: всё снаружи круга затемнено. */}
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ boxShadow: "0 0 0 999px rgba(0,0,0,0.62)", outline: "2px solid rgba(255,255,255,0.85)", outlineOffset: -2 }}
          />
        </div>

        <div className="flex w-full max-w-xs items-center gap-3 text-white/70">
          <span className="text-xs">−</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={zoom}
            onChange={(e) => onSlider(Number(e.target.value))}
            aria-label="Масштаб"
            className="h-1 flex-1 cursor-pointer accent-[oklch(0.8_0.16_162)]"
          />
          <span className="text-xs">+</span>
        </div>
        <p className="pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-xs text-white/50">
          {failed ? "Не удалось обработать картинку, выберите другую." : "Двигайте и приближайте фото, как в Telegram"}
        </p>
      </div>
    </div>,
    document.body,
  );
}
