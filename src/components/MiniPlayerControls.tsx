import { useRef } from "react";
import { Maximize2, Pause, Play, X } from "lucide-react";
import type { PlayerState } from "../lib/types";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";

const DRAG_THRESHOLD = 4;

/**
 * Controls of the mini player: play/pause, back to the full window, close, and a thin
 * progress line. Dragging anywhere else moves the window; a click pauses, a double
 * click restores the full player.
 */
export function MiniPlayerControls({
  heading,
  state,
  visible,
  live,
  onTogglePause,
  onRestore,
  onClose,
  onVideoClick,
  onVideoDoubleClick,
}: {
  heading: string;
  state: PlayerState;
  visible: boolean;
  live: boolean;
  onTogglePause: () => void;
  onRestore: () => void;
  onClose: () => void;
  onVideoClick: () => void;
  onVideoDoubleClick: () => void;
}) {
  const { t } = useI18n();
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const progress = state.duration > 0 ? Math.min(100, (state.time / state.duration) * 100) : 0;
  const icon = "grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65";

  return (
    <div
      className="absolute inset-0 z-20 cursor-default select-none"
      onPointerDown={(e) => {
        if (e.button !== 0 || e.target !== e.currentTarget) return;
        press.current = { x: e.clientX, y: e.clientY, dragging: false };
      }}
      onPointerMove={(e) => {
        const start = press.current;
        if (!start || start.dragging || !(e.buttons & 1)) return;
        if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) < DRAG_THRESHOLD) return;
        // The main window (the video) moves; the overlay follows it.
        start.dragging = true;
        void api.playerMiniDrag().catch(() => undefined);
      }}
      onPointerUp={(e) => {
        const start = press.current;
        press.current = null;
        if (start && !start.dragging && e.target === e.currentTarget) onVideoClick();
      }}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) onVideoDoubleClick();
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-200"
        style={{ opacity: visible || state.paused ? 1 : 0 }}
      >
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
        <p className="absolute top-2.5 right-24 left-3 truncate text-[12px] font-medium text-white/90">{heading}</p>
        <div className="pointer-events-auto absolute top-2 right-2 flex gap-1.5">
          <button type="button" className={icon} onClick={onRestore} aria-label={t("miniPlayerExit")} title={`${t("miniPlayerExit")} (P)`}>
            <Maximize2 size={14} />
          </button>
          <button type="button" className={icon} onClick={onClose} aria-label={t("close")} title={t("close")}>
            <X size={15} />
          </button>
        </div>
        <button
          type="button"
          className="btn-press pointer-events-auto absolute top-1/2 left-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65"
          onClick={onTogglePause}
          aria-label={state.paused ? t("play") : t("pause")}
        >
          {state.paused ? <Play size={22} fill="currentColor" className="translate-x-px" /> : <Pause size={22} fill="currentColor" />}
        </button>
      </div>
      {!live ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
          <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}
