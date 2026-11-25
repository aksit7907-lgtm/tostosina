// Звуки интерфейса Tosto. Синтезируются прямо в браузере (Web Audio), файлов не нужно.
export type SoundName = "send" | "receive" | "like" | "post" | "error";

const KEY = "tosto:sound";
const KEY_TYPING = "tosto:key-sound";
let ctx: AudioContext | null = null;
let enabled = true;
let typingEnabled = true;

try {
  enabled = localStorage.getItem(KEY) !== "off";
  typingEnabled = localStorage.getItem(KEY_TYPING) !== "off";
} catch {
  // хранилище недоступно, звук включён по умолчанию
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(value: boolean) {
  enabled = value;
  try {
    localStorage.setItem(KEY, value ? "on" : "off");
  } catch {
    // игнорируем
  }
}

export function isTypingSoundEnabled() {
  return typingEnabled;
}

export function setTypingSoundEnabled(value: boolean) {
  typingEnabled = value;
  try {
    localStorage.setItem(KEY_TYPING, value ? "on" : "off");
  } catch {
    // игнорируем
  }
}

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Одна нота: частота (можно плавно менять), старт, длительность, громкость. */
function tone(
  c: AudioContext,
  { from, to = from, at = 0, dur, vol = 0.12, type = "sine" }: {
    from: number; to?: number; at?: number; dur: number; vol?: number; type?: OscillatorType;
  },
) {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function playSound(name: SoundName) {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  switch (name) {
    case "send":
      tone(c, { from: 520, to: 880, dur: 0.11, vol: 0.1 });
      break;
    case "receive":
      tone(c, { from: 880, dur: 0.16, vol: 0.12 });
      tone(c, { from: 1318, at: 0.09, dur: 0.22, vol: 0.1 });
      break;
    case "like":
      tone(c, { from: 600, to: 1000, dur: 0.08, vol: 0.1 });
      tone(c, { from: 1200, at: 0.05, dur: 0.1, vol: 0.06 });
      break;
    case "post":
      tone(c, { from: 523, dur: 0.12, vol: 0.1 });
      tone(c, { from: 659, at: 0.08, dur: 0.12, vol: 0.1 });
      tone(c, { from: 784, at: 0.16, dur: 0.22, vol: 0.1 });
      break;
    case "error":
      tone(c, { from: 220, to: 160, dur: 0.18, vol: 0.12, type: "triangle" });
      break;
  }
}

/* ───────────── Звук клавиатуры ───────────── */

let noiseBuf: AudioBuffer | null = null;
let lastKeyAt = 0;

/** Короткий «клик» механической клавиши: щелчок шума плюс тихий низкий «тук». Тон слегка плавает, чтобы не надоедало. */
function keyClick(c: AudioContext, kind: "key" | "space" | "back" | "enter") {
  const t0 = c.currentTime;
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 0.03);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  const jitter = 0.92 + Math.random() * 0.16;
  const click = c.createBufferSource();
  click.buffer = noiseBuf;
  const hp = c.createBiquadFilter();
  hp.type = "bandpass";
  hp.frequency.value = (kind === "space" ? 1800 : kind === "back" ? 2600 : 3400) * jitter;
  hp.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(kind === "enter" ? 0.5 : 0.32, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
  click.connect(hp).connect(g).connect(c.destination);
  click.start(t0);

  const body = c.createOscillator();
  const bg = c.createGain();
  body.type = "sine";
  const f = (kind === "space" ? 120 : kind === "enter" ? 150 : 190) * jitter;
  body.frequency.setValueAtTime(f, t0);
  body.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + 0.05);
  bg.gain.setValueAtTime(0.0001, t0);
  bg.gain.exponentialRampToValueAtTime(kind === "space" ? 0.11 : 0.08, t0 + 0.004);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
  body.connect(bg).connect(c.destination);
  body.start(t0);
  body.stop(t0 + 0.07);
}

/**
 * Звук набора по изменению текста: работает и на экранной клавиатуре телефона,
 * где события keydown не содержат реальной клавиши.
 */
export function typingSound(prev: string, next: string) {
  if (!typingEnabled || prev === next) return;
  const now = performance.now();
  if (now - lastKeyAt < 28) return;
  lastKeyAt = now;
  const c = getCtx();
  if (!c) return;
  if (next.length < prev.length) return keyClick(c, "back");
  const added = next.slice(prev.length > 0 && next.startsWith(prev) ? prev.length : 0);
  if (added.includes("\n")) return keyClick(c, "enter");
  if (added === " ") return keyClick(c, "space");
  keyClick(c, "key");
}
