/** Types shared by the engine and its progress loop. */
import type { Movie, ResumeEntry } from "../../lib/types";
import type { PlaybackContext, ResolvedPlayback } from "../jellyfin/playback";

/** A locally remembered online title, without the fields the engine fills in. */
export type ResumeEntryBase = Omit<ResumeEntry, "positionSeconds" | "durationSeconds" | "updatedMs">;

/** Per-profile playback preferences applied to every source (mirrors `PlaybackPrefs` in Rust). */
export type PlaybackPrefs = {
  /** "" = file default, else ISO 639-2 ("spa"). */
  audioLanguage: string;
  /** "" = file default, "off" = no subtitles, else ISO 639-2. */
  subtitleLanguage: string;
  rememberSpeed: boolean;
  lastSpeed: number;
  /** Keep playing in the background / picture-in-picture (Settings › Playback). */
  backgroundAudio: boolean;
};

/** Where playback progress is reported to. */
export type PlaybackSource =
  | {
      kind: "jellyfin";
      playback: PlaybackContext;
      item: Movie;
      resolved: ResolvedPlayback;
      /** Media source the user asked for (version picker), resolved against the item. */
      mediaSourceId: string | undefined;
    }
  | { kind: "addon"; entry: ResumeEntryBase }
  | { kind: "live"; channelId: string }
  /** A downloaded file; `entry` is set for online titles (their progress stays local). */
  | { kind: "offline"; downloadId: string; itemId: string | null; entry: ResumeEntryBase | null };

export type EngineContext = {
  source: PlaybackSource;
  title: string;
  url: string;
};
