/**
 * The 10-second progress loop of the desktop app (`start_progress_loop` in lib.rs):
 * every tick reports the position to Jellyfin or to the local addon progress, then
 * pushes a state snapshot so the UI clocks stay in sync even without time events.
 */
import type { PlayerState } from "../../lib/types";
import { reportProgress } from "../jellyfin/playback";
import { upsertProgress } from "../addons";
import { ticksFromSeconds } from "../util";
import type { EngineContext } from "./types";

export const PROGRESS_INTERVAL_MS = 10_000;

/** Sends one progress report for `ctx`; never throws (reporting is best effort). */
export async function reportTick(ctx: EngineContext, snap: PlayerState): Promise<void> {
  try {
    switch (ctx.source.kind) {
      case "jellyfin":
        await reportProgress(ctx.source.playback, {
          positionTicks: ticksFromSeconds(snap.time),
          paused: snap.paused,
          muted: snap.mute,
          volume: Math.round(snap.volume),
        });
        break;
      case "addon":
        // Before the duration is known the stored entry (and its duration) is kept.
        if (snap.duration > 0) upsertProgress(ctx.source.entry, snap.time, snap.duration);
        break;
      case "live":
        break;
    }
  } catch (error) {
    console.warn("[player] progress report failed", error);
  }
}

/** Interval wrapper; `start` replaces a running loop, `stop` is idempotent. */
export class ProgressLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly intervalMs: number = PROGRESS_INTERVAL_MS) {}

  get running(): boolean {
    return this.timer != null;
  }

  start(tick: () => Promise<void> | void): void {
    this.stop();
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      Promise.resolve()
        .then(tick)
        .catch((error) => console.warn("[player] progress tick failed", error))
        .finally(() => {
          this.busy = false;
        });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
