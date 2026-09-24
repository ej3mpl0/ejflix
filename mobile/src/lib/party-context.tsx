import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "./api";
import { metaFullToMovie, videoToMovie } from "./addons";
import type { Movie } from "./types";
import { partyErrorKey } from "./party-errors";
import { useI18n } from "./locale-context";
import { useSession } from "./session-context";
import { useToast } from "./toast-context";
import { useStreamPicker } from "./stream-picker-context";
import { openPlayer } from "../navigation/navigationRef";
import { getPartyStatus, onPartyMessage, partyLeave, subscribeParty, type PartyStatus } from "../services/party";
import { expectedPosition, parseSync, titleLabel, type PartySync, type PartyTitle } from "../services/party.pure";
import { findLibraryItem } from "../services/party-library";
import { PartySheet } from "../components/party/PartySheet";

/** The party as the socket sees it, live. */
export function usePartyStatus(): PartyStatus {
  return useSyncExternalStore(subscribeParty, getPartyStatus);
}

/**
 * The host's title in this phone's sources: its Jellyfin library first, else the same
 * addon meta (`online`: a source still has to be chosen, or auto-picked).
 */
async function resolveTitle(title: PartyTitle): Promise<{ movie: Movie; online: boolean } | null> {
  if (title.kind === "unsupported") return null;
  const mark = (movie: Movie): Movie => ({ ...movie, partyKey: title.key });
  const found = await findLibraryItem(title).catch(() => null);
  if (found) return { movie: mark(found), online: false };
  const addon = title.addon;
  if (!addon) return null;
  const meta = await api.addonMeta(addon.type, addon.metaId).catch(() => null);
  if (!meta) return null;
  let movie: Movie;
  if (addon.type === "series") {
    const video =
      meta.videos.find((v) => v.id === addon.videoId) ??
      meta.videos.find((v) => v.season === title.season && v.episode === title.episode);
    if (!video) return null;
    movie = videoToMovie(meta, video);
  } else {
    movie = metaFullToMovie(meta);
  }
  if (!movie.external) return null;
  return { movie: mark({ ...movie, external: { ...movie.external, prefer: addon.prefer } }), online: true };
}

type PartyUi = { openSheet: () => void; openTitle: () => void };

const PartyContext = createContext<PartyUi>({ openSheet: () => undefined, openTitle: () => undefined });

export function useParty(): PartyUi {
  return useContext(PartyContext);
}

/**
 * Guest side of the party for the whole app: the join sheet, and whatever the host
 * plays opened here too (the first online title through the sources sheet, then
 * straight away so the next episode just follows).
 */
export function PartyProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const picker = useStreamPicker();
  const { session } = useSession();
  const status = usePartyStatus();
  const [sheet, setSheet] = useState(false);
  const handled = useRef<{ code: string; key: string | null; opened: number }>({ code: "", key: null, opened: 0 });
  const lastSync = useRef<{ sync: PartySync; at: number } | null>(null);
  const previous = useRef<PartyStatus>(status);
  const latest = useRef({ t, toast, picker, status });
  latest.current = { t, toast, picker, status };

  // Where the host is, to start close to it.
  useEffect(
    () =>
      onPartyMessage((message) => {
        if (message.event !== "sync" || !message.fromHost) return;
        const sync = parseSync(message.data);
        if (sync) lastSync.current = { sync, at: Date.now() };
      }),
    [],
  );

  // Another profile did not join this party.
  const userId = session?.userId ?? null;
  useEffect(() => () => partyLeave(), [userId]);

  const open = useCallback(async (title: PartyTitle, manual: boolean) => {
    const { t, toast, picker } = latest.current;
    if (title.kind === "unsupported") {
      toast(t("partyUnsupported"));
      return;
    }
    const found = await resolveTitle(title);
    // The host may have moved on while this was looking.
    if (latest.current.status.title?.key !== title.key) return;
    if (!found) {
      toast(t("partyUnavailable", { title: titleLabel(title) }));
      return;
    }
    const first = handled.current.opened === 0 || manual;
    handled.current.opened += 1;
    let movie = found.movie;
    const last = lastSync.current;
    if (last && last.sync.key === title.key) {
      const pos = expectedPosition(last.sync, last.sync.at + (Date.now() - last.at));
      movie = { ...movie, playbackPositionTicks: Math.round(pos * 10_000_000) };
    }
    setSheet(false);
    if (found.online && first) picker.open(movie);
    else openPlayer(movie);
  }, []);

  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (before.active && !status.active && status.error) toast(t(partyErrorKey(status.error)));
    if (!status.active) return;
    if (handled.current.code !== status.code) handled.current = { code: status.code, key: null, opened: 0 };
    const title = status.title;
    if (!title || title.key === handled.current.key) return;
    handled.current.key = title.key;
    void open(title, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const value = useMemo<PartyUi>(
    () => ({
      openSheet: () => setSheet(true),
      openTitle: () => {
        const title = latest.current.status.title;
        if (title && latest.current.status.active) void open(title, true);
      },
    }),
    [open],
  );

  return (
    <PartyContext.Provider value={value}>
      {children}
      <PartySheet visible={sheet} status={status} onClose={() => setSheet(false)} onOpenTitle={value.openTitle} />
    </PartyContext.Provider>
  );
}
