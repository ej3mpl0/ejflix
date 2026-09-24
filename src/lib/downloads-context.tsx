import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { useI18n } from "./locale-context";
import { errorText } from "./errors";
import type { DownloadItem, DownloadRequest } from "./types";

type DownloadsValue = {
  /** Newest first, as Rust keeps them. */
  items: DownloadItem[];
  /** How many are running right now. */
  active: number;
  start: (request: DownloadRequest) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reveal: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
};

const DownloadsContext = createContext<DownloadsValue | null>(null);

/**
 * Downloads of online sources. Rust owns the list and the files; this mirrors it
 * (`downloads://changed`) and reports what finished while the user was elsewhere.
 */
export function DownloadsProvider({
  onToast,
  children,
}: {
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<DownloadItem[]>([]);
  /** Status of each download at the previous update, to spot the ones that just ended. */
  const previous = useRef<Map<string, string>>(new Map());
  const onToastRef = useRef(onToast);
  const tRef = useRef(t);
  onToastRef.current = onToast;
  tRef.current = t;

  const apply = useCallback((next: DownloadItem[]) => {
    for (const item of next) {
      if (previous.current.get(item.id) !== "downloading" || item.status === "downloading") continue;
      if (item.status === "done") {
        onToastRef.current(tRef.current("downloadFinished", { name: item.name }));
      } else if (item.status === "error") {
        onToastRef.current(tRef.current("downloadFailed", { error: item.error ?? "" }));
      }
    }
    previous.current = new Map(next.map((item) => [item.id, item.status]));
    setItems(next);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .downloadsList()
      .then((list) => {
        if (alive) apply(list);
      })
      .catch(() => undefined);
    const unlisten = api.onDownloadsChanged((list) => {
      if (alive) apply(list);
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, [apply]);

  const report = useCallback(async (job: Promise<unknown>) => {
    try {
      await job;
    } catch (err) {
      onToastRef.current(errorText(tRef.current, err));
    }
  }, []);

  const start = useCallback(async (request: DownloadRequest) => {
    try {
      const item = await api.downloadStream(request);
      onToastRef.current(tRef.current("downloadStarted", { name: item.name }));
    } catch (err) {
      onToastRef.current(errorText(tRef.current, err));
    }
  }, []);

  const value = useMemo<DownloadsValue>(
    () => ({
      items,
      active: items.filter((item) => item.status === "downloading").length,
      start,
      cancel: (id) => report(api.downloadCancel(id)),
      remove: (id) => report(api.downloadRemove(id)),
      reveal: (id) => report(api.downloadReveal(id)),
      clearFinished: () => report(api.downloadsClear()),
    }),
    [items, start, report],
  );

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads(): DownloadsValue {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error("useDownloads requires DownloadsProvider");
  return ctx;
}
