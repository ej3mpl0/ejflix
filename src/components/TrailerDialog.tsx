import { ExternalLink, X } from "lucide-react";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import { Dialog } from "./Dialog";
import { Pill } from "./Pill";

/** YouTube video id of a watch / share / embed URL, when it is one. */
export function youtubeId(url: string): string | null {
  const match = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  return match ? match[1] : null;
}

/** First trailer of a title the dialog can play, if any. */
export function playableTrailer(urls: string[]): string | null {
  return urls.find((url) => youtubeId(url)) ?? null;
}

/** Trailer over the details page (YouTube's privacy-enhanced player), with a way out to YouTube. */
export function TrailerDialog({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const id = youtubeId(url);
  return (
    <Dialog
      labelledBy="trailer-title"
      onEscape={onClose}
      onBackdrop={onClose}
      z="z-[75]"
      className="w-[min(1100px,94vw)] overflow-hidden rounded-card bg-black shadow-[0_24px_80px_rgb(0_0_0_/_0.6)]"
    >
      <div className="flex items-center gap-3 bg-surface px-4 py-2.5">
        <h2 id="trailer-title" className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {t("trailer")} · {title}
        </h2>
        <Pill variant="ghost" size="sm" icon={<ExternalLink size={14} />} onClick={() => void api.openExternal(url).catch(() => undefined)}>
          {t("openOnYoutube")}
        </Pill>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          data-autofocus
          className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10"
        >
          <X size={16} />
        </button>
      </div>
      {id ? (
        <iframe
          title={`${t("trailer")} · ${title}`}
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`}
          className="aspect-video w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : null}
    </Dialog>
  );
}
