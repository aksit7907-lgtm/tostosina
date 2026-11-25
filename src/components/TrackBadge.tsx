import { useState } from "react";
import { ChevronDown, ChevronRight, Music2, Pause, Play } from "lucide-react";
import { embedFor, safeUrl } from "@/lib/embed";
import { usePlayer, usePlayerProgress } from "@/lib/player";

function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Полоса перемотки и кнопки ±10 секунд для трека, который сейчас играет. */
function SeekPanel() {
  const player = usePlayer();
  const { position, duration } = usePlayerProgress();
  const [scrub, setScrub] = useState<number | null>(null);
  const max = duration > 0 ? duration : 0;
  const shown = Math.min(scrub ?? position, max || 1);

  function commit() {
    if (scrub === null) return;
    player.seek(scrub);
    setScrub(null);
  }

  return (
    <div className="mt-2 w-full max-w-md rounded-2xl border border-border bg-surface-1 px-3.5 pb-3 pt-2.5">
      <input
        type="range"
        min={0}
        max={max || 1}
        step={0.1}
        value={shown}
        disabled={!max}
        aria-label="Перемотка"
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="block h-5 w-full accent-pulse disabled:opacity-40"
      />
      <div className="mt-0.5 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{clock(scrub ?? position)}</span>
        <span>{max ? clock(max) : "--:--"}</span>
      </div>
      <div className="mt-2 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => player.seek(Math.max(0, position - 10))}
          disabled={!max}
          className="press h-9 rounded-full bg-surface-2 px-4 text-sm font-medium text-foreground disabled:opacity-40"
        >
          −10 с
        </button>
        <button
          type="button"
          onClick={player.toggle}
          aria-label={player.playing ? "Пауза" : "Играть"}
          className="press flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          {player.playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => player.seek(Math.min(position + 10, max ? max - 0.5 : position + 10))}
          disabled={!max}
          className="press h-9 rounded-full bg-surface-2 px-4 text-sm font-medium text-foreground disabled:opacity-40"
        >
          +10 с
        </button>
      </div>
    </div>
  );
}

/**
 * Плашка «Артист — Трек» в профиле.
 * YouTube и SoundCloud играют через глобальный плеер (звук продолжается на других экранах),
 * Spotify и Apple Music раскрывают видимый плеер под плашкой.
 */
export function TrackBadge({
  url,
  title,
  artist,
}: {
  url?: string | null;
  title?: string | null;
  artist?: string | null;
}) {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(false);

  if (!url || !safeUrl(url)) return null;
  const embed = embedFor(url);
  const main = title?.trim() || "Трек";
  const sub = artist?.trim() || null;

  const isCurrent = player.track?.url === url;
  const showPause = embed?.audioOnly ? isCurrent && player.playing : open;

  function onPress() {
    if (!embed) return;
    if (!embed.audioOnly) {
      setOpen((v) => !v);
      return;
    }
    if (isCurrent) player.toggle();
    else {
      player.play({ url: url!, title: main, artist: sub });
      setPanel(true);
    }
  }

  /** Нажатие на название раскрывает перемотку (и запускает трек, если он ещё не играет). */
  function onOpenTrack() {
    if (!embed) return;
    if (!embed.audioOnly) {
      setOpen((v) => !v);
      return;
    }
    if (!isCurrent) {
      player.play({ url: url!, title: main, artist: sub });
      setPanel(true);
    } else setPanel((v) => !v);
  }
  const panelOpen = !!embed?.audioOnly && isCurrent && panel;

  return (
    <div className="mt-3 max-w-full">
      <div className="inline-flex h-10 max-w-full items-center gap-1 rounded-full bg-surface-2 border border-border pl-1.5 pr-1">
        {embed ? (
          <button
            type="button"
            onClick={onPress}
            aria-label={showPause ? "Пауза" : "Слушать"}
            className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            {showPause ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-pulse">
            <Music2 className="h-4 w-4" />
          </span>
        )}
        <button
          type="button"
          onClick={onOpenTrack}
          disabled={!embed}
          aria-expanded={panelOpen}
          aria-label="Открыть трек"
          className="flex min-w-0 items-center gap-1 pl-1 pr-1 text-left text-sm text-foreground disabled:cursor-default"
        >
          <span className="min-w-0 truncate">
            {sub ? (
              <>
                <span className="font-semibold">{sub}</span>
                <span className="text-muted-foreground"> - {main}</span>
              </>
            ) : (
              <span className="font-semibold">{main}</span>
            )}
          </span>
          {embed?.audioOnly && (
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${panelOpen ? "rotate-180" : ""}`}
            />
          )}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Открыть в сервисе"
          className="flex h-8 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </a>
      </div>

      {embed?.audioOnly && isCurrent && player.failed && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Этот трек нельзя проиграть внутри приложения. Открой его значком ссылки справа от названия.
        </p>
      )}

      {panelOpen && <SeekPanel />}

      {embed && !embed.audioOnly && open && (
        <div className="mt-2 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background">
          <iframe
            src={embed.src}
            title={`${main}${sub ? " — " + sub : ""}`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
            className="block w-full border-0"
            style={embed.height ? { height: embed.height } : { aspectRatio: embed.ratio ?? "16 / 9" }}
          />
        </div>
      )}
    </div>
  );
}
