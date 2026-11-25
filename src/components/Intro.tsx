import { motion, AnimatePresence } from "framer-motion";

type IntroProps = {
  show: boolean;
  onSkip?: () => void;
};

const WORD = "Tosto".split("");

/**
 * Заставка. Вся анимация на CSS (transform и opacity идут на GPU и не зависят от загруженности JS),
 * без blur, теней и бесконечных эффектов, поэтому не тормозит, пока под ней грузится приложение.
 * Хронология (≈1,9 с): контур логотипа рисуется → штрихи → точка «приземляется» и расходятся кольца →
 * буквы названия вырастают по очереди → полоска и слоган. Нажатие пропускает заставку.
 * При «убрать анимации» в системе (prefers-reduced-motion) показывается готовый кадр без движения.
 */
export function Intro({ show, onSkip }: IntroProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.28, ease: "easeOut" } }}
          onClick={onSkip}
        >
          <div className="intro-glow pointer-events-none absolute" aria-hidden="true" />

          <div className="relative flex flex-col items-center">
            <div className="relative h-24 w-24">
              <span className="intro-ring" style={{ animationDelay: "1s" }} aria-hidden="true" />
              <span className="intro-ring" style={{ animationDelay: "1.22s" }} aria-hidden="true" />
              <IntroMark />
            </div>

            <h1 className="mt-6 flex font-display text-5xl font-bold tracking-tight text-foreground" aria-label="Tosto">
              {WORD.map((ch, i) => (
                <span key={i} className="intro-letter" style={{ animationDelay: `${0.8 + i * 0.07}s` }} aria-hidden="true">
                  {ch}
                </span>
              ))}
            </h1>

            <div className="intro-line mt-4 h-[2px] w-24 rounded-full bg-pulse" aria-hidden="true" />
            <p className="intro-tag mt-4 text-sm tracking-wide text-muted-foreground">Пиши. Делись. Будь на связи.</p>
          </div>
          <span className="sr-only">Нажми, чтобы пропустить заставку</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Логотип с CSS-анимацией: контур рисуется (stroke-dashoffset), точка пружинит. */
function IntroMark() {
  const body =
    "M16 7H48C53 7 57 11 57 16V43C57 48 53 52 48 52H24.5L13.5 58.5L15.8 49.8C10.5 48.2 7 44.5 7 39.5V16C7 11 11 7 16 7Z";
  return (
    <svg viewBox="0 0 64 64" className="relative h-24 w-24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="intro-bg" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C1E22" />
          <stop offset="1" stopColor="#060607" />
        </linearGradient>
        <linearGradient id="intro-rim" x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#71717A" stopOpacity="0.25" />
          <stop offset="1" stopColor="#34D399" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="intro-mark" x1="18" y1="18" x2="46" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#A1A1AA" />
        </linearGradient>
      </defs>
      <path className="intro-fill" d={body} fill="url(#intro-bg)" />
      <path className="intro-draw" d={body} pathLength={1} stroke="url(#intro-rim)" strokeWidth="2.2" strokeLinejoin="round" style={{ animationDelay: "0s" }} />
      <path className="intro-draw" d="M19 21.5H45" pathLength={1} stroke="url(#intro-mark)" strokeWidth="4.4" strokeLinecap="round" style={{ animationDelay: "0.4s", animationDuration: "0.45s" }} />
      <path className="intro-draw" d="M32 21.5V41.5" pathLength={1} stroke="url(#intro-mark)" strokeWidth="4.4" strokeLinecap="round" style={{ animationDelay: "0.55s", animationDuration: "0.45s" }} />
      <circle className="intro-dot" cx="45.5" cy="39.5" r="4.2" fill="#34D399" />
    </svg>
  );
}
