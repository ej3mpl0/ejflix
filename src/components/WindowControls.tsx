import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import { useI18n } from "../lib/locale-context";

export function WindowControls() {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  // Follow every resize: a double-click on the header or a Windows snap also maximizes.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let alive = true;
    try {
      const win = getCurrentWindow();
      const sync = () => win.isMaximized().then((v) => alive && setMaximized(v)).catch(() => undefined);
      void sync();
      win
        .onResized(() => void sync())
        .then((fn) => {
          if (alive) unlisten = fn;
          else fn();
        })
        .catch(() => undefined);
    } catch {
      /* browser preview */
    }
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setMaximized(await getCurrentWindow().isMaximized());
    } catch {
      /* browser preview */
    }
  };

  return (
    <div className="flex h-full">
      <button
        className="grid h-full w-[46px] place-items-center text-text/80 hover:bg-white/10"
        onClick={() => act(() => getCurrentWindow().minimize())}
        aria-label={t("minimize")}
      >
        <Minus size={14} />
      </button>
      <button
        className="grid h-full w-[46px] place-items-center text-text/80 hover:bg-white/10"
        onClick={() => act(() => getCurrentWindow().toggleMaximize())}
        aria-label={maximized ? t("restore") : t("maximize")}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        className="grid h-full w-[46px] place-items-center text-text/80 hover:bg-[#E81123] hover:text-white"
        onClick={() => act(() => getCurrentWindow().close())}
        aria-label={t("close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
