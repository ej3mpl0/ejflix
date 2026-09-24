import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { usePageVisible, useReducedMotion } from "../lib/motion";
import { youtubeId } from "./TrailerDialog";

const ORIGIN = "https://www.youtube-nocookie.com";
/** A player that has not started by then is given up on (blocked, removed video, offline). */
const LOAD_TIMEOUT_MS = 10_000;
const FADE_MS = 600;

/** idle → waiting out the delay; loading → the player is there but not playing yet (invisible). */
export type TrailerPhase = "idle" | "loading" | "playing" | "ended" | "failed";

function embedUrl(id: string, loop: boolean): string {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
    disablekb: "1",
    fs: "0",
    cc_load_policy: "0",
    enablejsapi: "1",
  });
  // A single video only loops as its own one-item playlist.
  if (loop) {
    params.set("loop", "1");
    params.set("playlist", id);
  }
  if (/^https?:/.test(window.location.origin)) params.set("origin", window.location.origin);
  return `${ORIGIN}/embed/${id}?${params.toString()}`;
}

/**
 * Muted YouTube trailer behind a backdrop. It waits `delay` ms, loads the player invisibly
 * and fades it in only once the IFrame API reports it playing, so a black box never shows;
 * the backdrop image underneath stays the fallback for every failure. Off with the
 * "Autoplay trailers" setting, reduced motion, a hidden window or `active` false.
 * Fill the parent (`absolute inset-0`), the video is scaled to cover it.
 */
export function TrailerBackdrop({
  url,
  active,
  muted,
  delay = 3500,
  loop = false,
  onPhase,
  className,
}: {
  url: string | null;
  active: boolean;
  muted: boolean;
  delay?: number;
  loop?: boolean;
  onPhase?: (phase: TrailerPhase) => void;
  className?: string;
}) {
  const { settings } = useSettings();
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const id = url ? youtubeId(url) : null;
  const enabled = Boolean(id) && active && visible && !reduced && settings.appearance.autoplayTrailers;
  const [phase, setPhase] = useState<TrailerPhase>("idle");
  const [mounted, setMounted] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    onPhaseRef.current?.(phase);
  }, [phase]);

  // Arm after the delay; anything that disables it tears the player down at once.
  useEffect(() => {
    setPhase("idle");
    setMounted(false);
    if (!enabled) return;
    const handle = window.setTimeout(() => {
      setMounted(true);
      setPhase("loading");
    }, delay);
    return () => window.clearTimeout(handle);
  }, [enabled, id, delay]);

  const post = (message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ ...message, id: 1, channel: "widget" }), ORIGIN);
  };
  const command = (func: string, args: unknown[] = []) => post({ event: "command", func, args });

  // IFrame API over postMessage: announce ourselves until the player answers, then follow its state.
  useEffect(() => {
    if (!mounted) return;
    let heard = false;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== ORIGIN || e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown } | null = null;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      if (!heard) {
        heard = true;
        command("addEventListener", ["onStateChange"]);
        command("addEventListener", ["onError"]);
        command(mutedRef.current ? "mute" : "unMute");
      }
      if (data.event === "onError") {
        setPhase("failed");
        return;
      }
      const info = data.info as { playerState?: number } | number | null | undefined;
      const state =
        data.event === "onStateChange"
          ? (info as number)
          : info && typeof info === "object" && typeof info.playerState === "number"
            ? info.playerState
            : undefined;
      if (state === 1) setPhase("playing");
      else if (state === 0 && !loop) setPhase("ended");
    };
    window.addEventListener("message", onMessage);
    const ping = window.setInterval(() => {
      if (heard) window.clearInterval(ping);
      else post({ event: "listening" });
    }, 250);
    const timeout = window.setTimeout(() => {
      setPhase((current) => (current === "loading" ? "failed" : current));
    }, LOAD_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(ping);
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, loop]);

  useEffect(() => {
    if (mounted) command(muted ? "mute" : "unMute");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  // Ended or failed: fade out, then drop the player (the backdrop takes over again).
  useEffect(() => {
    if (phase !== "ended" && phase !== "failed") return;
    const handle = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(handle);
  }, [phase]);

  if (!mounted || !id) return null;

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden transition-opacity ease-std",
        phase === "playing" ? "opacity-100" : "opacity-0",
        className,
      )}
      style={{ containerType: "size", transitionDuration: `${FADE_MS}ms` }}
    >
      <iframe
        ref={frame}
        title="trailer"
        tabIndex={-1}
        src={embedUrl(id, loop)}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => post({ event: "listening" })}
        // 16:9 scaled to cover the box (a little over, so YouTube's edges stay out of sight).
        className="absolute top-1/2 left-1/2 border-0"
        style={{
          width: "max(100cqw, 177.78cqh)",
          height: "max(100cqh, 56.25cqw)",
          transform: "translate(-50%, -50%) scale(1.18)",
        }}
      />
    </div>
  );
}

/** Round mute / unmute toggle shown while a trailer plays. */
export function TrailerMuteButton({
  muted,
  onToggle,
  className,
}: {
  muted: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const label = muted ? t("unmute") : t("mute");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={!muted}
      title={label}
      className={cn(
        "fade-in grid h-10 w-10 place-items-center rounded-full border border-white/30 bg-black/40 text-white backdrop-blur-sm hover:border-white/60 hover:bg-black/60",
        className,
      )}
    >
      {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
    </button>
  );
}
