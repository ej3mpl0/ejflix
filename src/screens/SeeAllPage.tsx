import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { Movie } from "../lib/types";
import type { SeeAllRequest } from "../lib/see-all-context";
import { useBackNavigation } from "../lib/use-back";
import { useI18n } from "../lib/locale-context";
import { useCustomLists } from "../lib/lists-context";
import { fieldClass } from "../lib/ui";
import { cn } from "../lib/format";
import { PosterCard } from "../components/PosterCard";
import { FloatingTitleBar } from "../components/FloatingTitleBar";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { ListActions } from "../components/ListActions";
import { ConfirmButton } from "../components/ConfirmButton";
import { EmptyState } from "../components/EmptyState";
import { Pill } from "../components/Pill";
import { handlePosterArrows } from "../lib/poster-nav";
import { PosterGridItemsSkeleton } from "../components/Skeletons";

/** A Home row as a full grid, over Home (which keeps its scroll); pages in more when it can. */
export function SeeAllPage({
  request,
  top,
  onBack,
  onOpen,
  onPlay,
}: {
  request: SeeAllRequest;
  /** Only while nothing else is on top does it react to back navigation. */
  top: boolean;
  onBack: () => void;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const { lists, moviesOf, rename, remove, setItem } = useCustomLists();
  const [items, setItems] = useState<Movie[]>(request.items);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!request.loadMore);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  /** A custom list follows its live contents: removing a title takes it off the grid. */
  const list = request.listId ? lists.find((l) => l.id === request.listId) ?? null : null;
  const shown = list ? moviesOf(list) : items;
  const title = list?.name ?? request.title;

  useBackNavigation(top ? onBack : null);

  // The list was deleted (here or by a sync): nothing left to show.
  const gone = Boolean(request.listId) && !list;
  useEffect(() => {
    if (gone) onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);

  const more = async () => {
    if (!request.loadMore || loading || done) return;
    setLoading(true);
    try {
      const page = await request.loadMore(items.length);
      const known = new Set(items.map((movie) => movie.id));
      const fresh = page.filter((movie) => !known.has(movie.id));
      if (!fresh.length) setDone(true);
      else setItems((current) => [...current, ...fresh]);
    } catch {
      setDone(true);
    } finally {
      setLoading(false);
    }
  };

  const saveName = async () => {
    if (!list || !name.trim()) return;
    await rename(list.id, name);
    setEditing(false);
  };

  return (
    <div className="page-enter absolute inset-0 z-30 overflow-hidden bg-base text-text" aria-hidden={!top}>
      <div ref={scroller} className="absolute inset-0 overflow-y-auto" onKeyDown={(e) => handlePosterArrows(e, scroller.current)}>
        <div className="px-page pt-24 pb-16">
          {list && editing ? (
            <form
              className="mb-6 flex max-w-[560px] items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <input
                autoFocus
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  // Escape leaves the field, not the page.
                  e.preventDefault();
                  setEditing(false);
                }}
                aria-label={t("listName")}
                className={cn(fieldClass, "min-w-0 flex-1")}
              />
              <Pill variant="primary" type="submit" icon={<Check size={16} />} disabled={!name.trim()}>
                {t("save")}
              </Pill>
              <Pill variant="ghost" icon={<X size={16} />} onClick={() => setEditing(false)}>
                {t("cancel")}
              </Pill>
            </form>
          ) : (
            <h1 className="mb-6 text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
          )}
          {list ? (
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <ListActions items={shown} onPlay={onPlay} />
              <Pill
                variant="ghost"
                pill
                icon={<Pencil size={15} />}
                onClick={() => {
                  setName(list.name);
                  setEditing(true);
                }}
              >
                {t("renameList")}
              </Pill>
              <ConfirmButton
                confirmLabel={t("delete")}
                prompt={t("deleteListAsk")}
                onConfirm={() => remove(list.id)}
                trigger={(ask) => (
                  <Pill variant="ghost" pill icon={<Trash2 size={15} />} onClick={ask}>
                    {t("deleteList")}
                  </Pill>
                )}
              />
            </div>
          ) : null}
          {list && !shown.length ? (
            <EmptyState title={t("emptyCustomList")} hint={t("emptyCustomListHint")} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
              {shown.map((movie, i) => (
                <PosterCard
                  key={movie.id}
                  movie={movie}
                  onOpen={onOpen}
                  onPlay={onPlay}
                  layout="grid"
                  delay={Math.min(i, 24) * 20}
                  menu={
                    list
                      ? [
                          {
                            id: "remove",
                            label: t("removeFromThisList"),
                            icon: <X size={15} />,
                            onSelect: () => void setItem(list.id, movie, false),
                          },
                        ]
                      : undefined
                  }
                />
              ))}
              {/* The next page's slots, so the grid grows in place instead of jumping. */}
              {loading && !list ? <PosterGridItemsSkeleton count={6} titles /> : null}
            </div>
          )}
          {!done && !list ? <LoadMoreButton loading={loading} onLoad={() => void more()} /> : null}
        </div>
      </div>
      <FloatingTitleBar title={title} onBack={onBack} />
    </div>
  );
}
