import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey } from "../lib/i18n";
import { labelKeyFor, segmentAt, segmentKey, skipModeFor } from "../lib/segments";
import type { MediaSegment, Movie, Settings } from "../lib/types";

/** Seconds the prompt stays on screen before hiding by itself (Nuvio: 10 s). */
export const SKIP_PROMPT_SECONDS = 10;

export type SkipPrompt = {
  segment: MediaSegment;
  key: string;
  labelKey: MessageKey;
  /** Changes every time the prompt is (re)shown; restarts the progress animation. */
  showId: number;
};

/**
 * Decides when a "Skip intro/recap/credits" prompt is shown and performs the skip.
 *
 * - "ask": prompt while inside the segment; auto-hides after 10 s, re-shown on `reveal()`.
 * - "auto": seeks once when the segment is entered; seeking back into it later shows the
 *   prompt instead (no loops). Starting playback inside an intro counts as entering it.
 * - "off": nothing.
 * - An outro with a next episode is left to the next-episode card.
 */
export function useSkipPrompt({
  segments,
  time,
  duration,
  ready,
  settings,
  controlsVisible,
  nextEpisode,
  onSeekTo,
  onPlayNext,
}: {
  segments: MediaSegment[];
  time: number;
  duration: number;
  ready: boolean;
  settings: Settings;
  controlsVisible: boolean;
  nextEpisode: Movie | null;
  onSeekTo: (seconds: number) => void;
  onPlayNext: () => void;
}): { prompt: SkipPrompt | null; skip: () => void; dismiss: () => void; reveal: () => void } {
  const [prompt, setPrompt] = useState<SkipPrompt | null>(null);
  const [hidden, setHidden] = useState(false);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const activeKey = useRef<string | null>(null);
  const autoSkipped = useRef(new Set<string>());
  const hiddenRef = useRef(false);
  hiddenRef.current = hidden;
  const showCounter = useRef(0);
  const latest = useRef({ settings, nextEpisode, onSeekTo, onPlayNext, duration });
  latest.current = { settings, nextEpisode, onSeekTo, onPlayNext, duration };

  // Enter / leave detection with hysteresis.
  useEffect(() => {
    if (!ready || duration <= 0) return;
    const active = segmentAt(segments, time, activeKey.current);
    const key = active ? segmentKey(active) : null;
    if (key === activeKey.current) return;
    activeKey.current = key;
    if (!active || !key) {
      setPrompt(null);
      return;
    }
    const { settings: current, nextEpisode: next, onSeekTo: seek, onPlayNext: playNext } = latest.current;
    const mode = skipModeFor(active.kind, current);
    if (mode === "off") {
      setPrompt(null);
      return;
    }
    if (mode === "auto" && !autoSkipped.current.has(key)) {
      autoSkipped.current.add(key);
      setPrompt(null);
      if (active.kind === "outro" && next) playNext();
      else seek(Math.min(active.endSeconds, latest.current.duration - 1));
      return;
    }
    if (active.kind === "outro" && next) {
      setPrompt(null);
      return;
    }
    showCounter.current += 1;
    setHidden(false);
    setPrompt({ segment: active, key, labelKey: labelKeyFor(active.kind), showId: showCounter.current });
  }, [segments, time, duration, ready]);

  // Auto-hide after a while; every (re)show restarts the timer.
  useEffect(() => {
    if (!prompt) return;
    const handle = setTimeout(() => setHidden(true), SKIP_PROMPT_SECONDS * 1000);
    return () => clearTimeout(handle);
  }, [prompt]);

  const reveal = useCallback(() => {
    if (!hiddenRef.current) return;
    showCounter.current += 1;
    setHidden(false);
    setPrompt((current) => (current ? { ...current, showId: showCounter.current } : current));
  }, []);

  useEffect(() => {
    if (controlsVisible) reveal();
  }, [controlsVisible, reveal]);

  const skip = useCallback(() => {
    const current = promptRef.current;
    if (!current) return;
    setPrompt(null);
    latest.current.onSeekTo(Math.min(current.segment.endSeconds, latest.current.duration - 1));
  }, []);

  const dismiss = useCallback(() => setPrompt(null), []);

  return { prompt: hidden ? null : prompt, skip, dismiss, reveal };
}
