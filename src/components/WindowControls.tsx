import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import { useI18n } from "../lib/locale-context";

export function WindowControls() {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => undefined);
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
