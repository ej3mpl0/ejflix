import { ArrowLeft } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WindowControls } from "./WindowControls";
import { useI18n } from "../lib/locale-context";

/**
 * Top bar of a details page: back button, window drag region and window controls.
 * The title and the glass background fade in once the hero has scrolled past
 * (`--scroll-y` is set by the page scroller).
 */
export function FloatingTitleBar({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-[60px] items-center">
      <div
        aria-hidden
        className="glass-header pointer-events-none absolute inset-0"
        style={{ opacity: "clamp(0, calc((var(--scroll-y, 0) - 320) / 80), 1)" }}
      />
      <div
        className="relative flex h-full min-w-0 flex-1 items-center gap-3 px-4"
        data-tauri-drag-region
        onDoubleClick={() => getCurrentWindow().toggleMaximize().catch(() => undefined)}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="icon-hit grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
        >
          <ArrowLeft size={20} />
        </button>
        <p
          className="truncate text-[15px] font-semibold text-text"
          data-tauri-drag-region
          style={{ opacity: "clamp(0, calc((var(--scroll-y, 0) - 340) / 80), 1)" }}
        >
          {title}
        </p>
      </div>
      <div className="relative h-full">
        <WindowControls />
      </div>
    </div>
  );
}
