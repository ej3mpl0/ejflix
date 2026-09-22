import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Movie, Person } from "../lib/types";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import { Dialog } from "./Dialog";
import { PosterCard } from "./PosterCard";
import { Shimmer } from "./Shimmer";
import { EmptyState } from "./EmptyState";

/** A cast or crew member: their picture and what of theirs is in the library. */
export function PersonDialog({
  person,
  onClose,
  onOpen,
  onPlay,
}: {
  person: Person;
  onClose: () => void;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<Movie[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .personItems(person.id)
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [person.id]);

  const open = (movie: Movie) => {
    onClose();
    onOpen(movie);
  };

  return (
    <Dialog
      labelledBy="person-title"
      onEscape={onClose}
      onBackdrop={onClose}
      z="z-[75]"
      className="flex max-h-[86vh] w-[min(920px,94vw)] flex-col overflow-hidden rounded-card bg-surface shadow-[0_24px_80px_rgb(0_0_0_/_0.55)]"
    >
      <div className="flex items-center gap-4 px-6 pt-6 pb-4">
        <div className="img-outline grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-panel text-[18px] font-semibold text-muted">
          {person.imageUrl ? <img src={person.imageUrl} alt="" className="h-full w-full object-cover" /> : person.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="person-title" className="truncate text-[20px] font-semibold">
            {person.name}
          </h2>
          <p className="text-[13px] text-dim">{t("personInLibrary")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          data-autofocus
          className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"
        >
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {error ? (
          <EmptyState title={t("cannotConnect")} hint={error} />
        ) : items == null ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Shimmer key={i} className="aspect-[2/3] rounded-poster" delay={i * 50} />
            ))}
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {items.map((movie, i) => (
              <PosterCard key={movie.id} movie={movie} onOpen={open} onPlay={onPlay} layout="grid" delay={i * 15} />
            ))}
          </div>
        ) : (
          <EmptyState title={t("personNothing")} />
        )}
      </div>
    </Dialog>
  );
}
