import { useEffect, useMemo, useState } from "react";
import type { Channel, EpgNow } from "../lib/types";
import { api } from "../lib/api";

const REFRESH_MS = 60_000;

/**
 * Programme on air (and next) for the channels on screen that have a guide, refreshed every
 * minute. Entries are merged, so scrolling back to a channel shows its programme at once.
 */
export function useEpgNow(channels: Channel[]): Record<string, EpgNow> {
  const [epg, setEpg] = useState<Record<string, EpgNow>>({});
  const ids = useMemo(() => channels.filter((c) => c.epg).map((c) => c.id), [channels]);
  const idsKey = ids.join(",");

  useEffect(() => {
    if (!ids.length) return;
    let alive = true;
    const load = () => {
      api
        .iptvEpgNow(ids)
        .then((map) => {
          if (alive) setEpg((previous) => ({ ...previous, ...map }));
        })
        .catch(() => undefined);
    };
    load();
    const handle = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return epg;
}
