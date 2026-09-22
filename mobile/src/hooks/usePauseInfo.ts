import { useEffect, useState } from "react";

const PAUSE_INFO_DELAY_MS = 1500;

/** True once playback has been paused for a moment and the controls are visible. */
export function usePauseInfo(paused: boolean, controlsVisible: boolean): boolean {
  const [longPause, setLongPause] = useState(false);

  useEffect(() => {
    if (!paused) {
      setLongPause(false);
      return;
    }
    const handle = setTimeout(() => setLongPause(true), PAUSE_INFO_DELAY_MS);
    return () => clearTimeout(handle);
  }, [paused]);

  return longPause && controlsVisible;
}
