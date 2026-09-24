import { useEffect, useRef } from "react";
import {
  expectedPosition,
  partyApi,
  partyErrorKey,
  partyTitleLabel,
  resolvePartyTitle,
  type PartyStatus,
  type PartySync,
  type PartyTitle,
} from "../lib/party";
import { useI18n } from "../lib/locale-context";
import type { Movie } from "../lib/types";
import { useParty } from "./useParty";

/**
 * Main window side of the party: says why a party ended, and as a guest opens whatever
 * the host plays (the first time through the sources sheet for an online title, then
 * straight away with the host's addon preferred, so the next episode just follows).
 */
export function usePartyGuest({
  hasServer,
  onPlay,
  onPick,
  onToast,
  onOpened,
}: {
  hasServer: boolean;
  onPlay: (movie: Movie) => void;
  /** Online title the guest still has to choose a source for. */
  onPick: (movie: Movie) => void;
  onToast: (message: string) => void;
  /** A title was opened (the party dialog can step aside). */
  onOpened: () => void;
}): { status: PartyStatus | null; openTitle: () => void } {
  const { t } = useI18n();
  const status = useParty();
  const handled = useRef<{ code: string; key: string | null; opened: number }>({ code: "", key: null, opened: 0 });
  const lastSync = useRef<{ sync: PartySync; at: number } | null>(null);
  const previous = useRef<PartyStatus | null>(null);
  const props = useRef({ hasServer, onPlay, onPick, onToast, onOpened, t });
  props.current = { hasServer, onPlay, onPick, onToast, onOpened, t };

  // Where the host is, to start the guest's player close to it.
  useEffect(() => {
    const unlisten = partyApi.onMessage((message) => {
      if (message.event !== "sync" || !message.fromHost) return;
      const sync = message.data as PartySync;
      if (typeof sync?.pos === "number" && typeof sync.key === "string") lastSync.current = { sync, at: Date.now() };
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Switching profile leaves the party (the next profile did not join it).
  useEffect(
    () => () => {
      void partyApi.leave().catch(() => undefined);
    },
    [],
  );

  const open = async (title: PartyTitle, manual: boolean) => {
    const { hasServer, onPlay, onPick, onToast, onOpened, t } = props.current;
    if (title.kind === "unsupported") {
      onToast(t("partyUnsupported"));
      return;
    }
    const found = await resolvePartyTitle(title, hasServer);
    // The host may have moved on while this was looking.
    if (!found || previous.current?.title?.key !== title.key) {
      if (!found) onToast(t("partyUnavailable", { title: partyTitleLabel(title) }));
      return;
    }
    const first = handled.current.opened === 0 || manual;
    handled.current.opened += 1;
    let movie = found.movie;
    const last = lastSync.current;
    if (last && last.sync.key === title.key) {
      // Local clock: close enough to start near the host; the player then fine-tunes.
      const pos = expectedPosition(last.sync, last.sync.at + (Date.now() - last.at));
      movie = { ...movie, playbackPositionTicks: Math.round(pos * 10_000_000) };
    }
    onOpened();
    if (found.online && first) onPick(movie);
    else onPlay(movie);
  };

  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (!status) return;
    if (before?.active && !status.active && status.error) {
      onToast(t(partyErrorKey(status.error)));
    }
    if (!status.active || status.host) return;
    if (handled.current.code !== status.code) handled.current = { code: status.code, key: null, opened: 0 };
    const title = status.title;
    if (!title || title.key === handled.current.key) return;
    handled.current.key = title.key;
    void open(title, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const openTitle = () => {
    const title = previous.current?.title;
    if (title && previous.current?.active && !previous.current.host) void open(title, true);
  };

  return { status, openTitle };
}
