import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { usePanZoom } from "@/lib/usePanZoom";
import { useBackHandler } from "@/lib/backStack";

/**
 * Полноэкранный просмотр картинки как в Telegram:
 * щипок и колесо — масштаб, двойной тап — приближение, перетаскивание, свайп вниз — закрыть.
 */
export function ImageViewer({
  src,
  alt = "",
  round = false,
  onClose,
}: {
  src: string;
  alt?: string;
  /** Показать круглой (для аватарок). */
  round?: boolean;
  onClose: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 160);
  }, [onClose]);
  useBackHandler(true, close, 70);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const pz = usePanZoom({
    minScale: 1,
    maxScale: 5,
    doubleTapScale: 2.5,
    bounds: (s) => {
      const el = imgRef.current;
      if (!el) return { mx: 0, my: 0 };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        mx: Math.max(0, (el.offsetWidth * s - vw) / 2),
        my: Math.max(0, (el.offsetHeight * s - vh) / 2),
      };
    },
    apply: (t, animate) => {
      const el = imgRef.current;
      if (!el) return;
      el.style.transition = animate ? "transform 0.22s cubic-bezier(0.23,1,0.32,1)" : "none";
      el.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.s})`;
      setZoomed(t.s > 1.02);
      if (backdropRef.current) backdropRef.current.style.opacity = "1";
    },
    onDismissDrag: (dy, released) => {
      const el = imgRef.current;
      const bd = backdropRef.current;
      if (!el || !bd) return;
      if (released) {
        if (Math.abs(dy) > 110) {
          el.style.transition = "transform 0.18s ease-out";
          el.style.transform = `translate3d(0, ${dy > 0 ? "100vh" : "-100vh"}, 0)`;
          close();
        } else {
          el.style.transition = "transform 0.22s cubic-bezier(0.23,1,0.32,1)";
          el.style.transform = "translate3d(0,0,0) scale(1)";
          bd.style.opacity = "1";
        }
        return;
      }
      el.style.transition = "none";
      el.style.transform = `translate3d(0, ${dy}px, 0) scale(${Math.max(0.7, 1 - Math.abs(dy) / 900)})`;
      bd.style.opacity = String(Math.max(0.2, 1 - Math.abs(dy) / 380));
    },
  });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`fixed inset-0 z-[90] ${closing ? "opacity-0 transition-opacity duration-150" : "anim-fade"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
    >
      <div ref={backdropRef} className="absolute inset-0 bg-black/95" />
      <div
        className="absolute inset-0 flex touch-none select-none items-center justify-center"
        {...pz.bind}
        onDoubleClick={(e) => e.preventDefault()}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          className={`max-h-full max-w-full object-contain will-change-transform ${round ? "aspect-square rounded-full object-cover" : ""}`}
          style={round ? { width: "min(92vw, 70vh)", height: "min(92vw, 70vh)" } : undefined}
        />
      </div>
      <button
        type="button"
        aria-label="Закрыть"
        onClick={close}
        className="press absolute right-4 top-[calc(0.75rem+env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur"
      >
        <X className="h-5 w-5" />
      </button>
      {!zoomed && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] text-center text-xs text-white/50">
          Двойной тап или щипок — масштаб
        </p>
      )}
    </div>,
    document.body,
  );
}
