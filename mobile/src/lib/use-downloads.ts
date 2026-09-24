import { useEffect, useState } from "react";
import { api } from "./api";
import type { DownloadEntry } from "../services/downloads/downloads.pure";

/** Offline downloads of the active profile, kept current through `downloads://changed`. */
export function useDownloads(): DownloadEntry[] {
  const [list, setList] = useState<DownloadEntry[]>(() => api.downloadsList());
  useEffect(() => {
    setList(api.downloadsList());
    const unlisten = api.onDownloadsChanged(() => setList(api.downloadsList()));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  return list;
}

/** The download of one item (null when there is none). */
export function useDownloadEntry(id: string): DownloadEntry | null {
  const list = useDownloads();
  return list.find((entry) => entry.id === id) ?? null;
}
