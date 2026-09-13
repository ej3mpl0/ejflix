import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaSegment, Movie } from "../lib/types";

/** Without credits data, the card appears this many seconds before the end. */
export const NEXT_BUTTON_WINDOW = 30;

type Dismissed = "none" | "untilEof" | "forever";

/**
 * Next-episode card rules:
 * - Appears at the start of the credits when an outro segment is known, otherwise in the
 *   last `NEXT_BUTTON_WINDOW` seconds (and at end of file).
 * - The countdown starts right away when the trigger is a known outro; without segment
 *   data it starts at end of file, as before.
 * - `countdownSeconds === 0` never autoplays: the card is just a button.
 * - Dismissing hides it until end of file, where it comes back without a countdown.
 */
export function useNextEpisodeCard({
  nextEpisode,
  outro,
  time,
  duration,
  eof,
  ready,
  countdownSeconds,
  onPlayNext,
}: {
  nextEpisode: Movie | null;
  outro: MediaSegment | null;
  time: number;
  duration: number;
  eof: boolean;
  ready: boolean;
  countdownSeconds: number;
  onPlayNext: () => void;
}): { visible: boolean; countdown: number | null; dismiss: () => void } {
  const [dismissed, setDismissed] = useState<Dismissed>("none");
  const [countdown, setCountdown] = useState<number | null>(null);
  const onPlayNextRef = useRef(onPlayNext);
  onPlayNextRef.current = onPlayNext;

  const triggerAt = outro ? outro.startSeconds : duration - NEXT_BUTTON_WINDOW;
  const inWindow = ready && duration > 0 && (eof || time >= triggerAt);
  const visible =
    nextEpisode != null &&
    inWindow &&
    dismissed !== "forever" &&
    !(dismissed === "untilEof" && !eof);
  const shouldCount = visible && countdownSeconds > 0 && dismissed === "none" && (outro != null || eof);

  useEffect(() => {
    if (!shouldCount) {
      setCountdown(null);
      return;
    }
    const started = Date.now();
    setCountdown(countdownSeconds);
    const handle = window.setInterval(() => {
      const left = countdownSeconds - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        window.clearInterval(handle);
        onPlayNextRef.current();
      } else {
        setCountdown(left);
      }
    }, 250);
    return () => window.clearInterval(handle);
  }, [shouldCount, countdownSeconds]);

  const dismiss = useCallback(() => {
    setDismissed(eof ? "forever" : "untilEof");
  }, [eof]);

  return { visible, countdown: shouldCount ? countdown : null, dismiss };
}
