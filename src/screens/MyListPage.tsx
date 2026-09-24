import { useState } from "react";
import { Compass, ListPlus, Plus } from "lucide-react";
import type { CustomList, Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";
import { useCustomLists } from "../lib/lists-context";
import { useSeeAll } from "../lib/see-all-context";
import { fieldClass } from "../lib/ui";
import { cn } from "../lib/format";
import { PosterCard } from "../components/PosterCard";
import { EmptyState } from "../components/EmptyState";
import { ListActions } from "../components/ListActions";
import { Pill } from "../components/Pill";

/** A custom list as a tile: a strip of its first posters, its name and size. */
function ListTile({ list, items, onOpen }: { list: CustomList; items: Movie[]; onOpen: () => void }) {
  const { t } = useI18n();
  const posters = items.slice(0, 4);
  return (
    <button type="button" onClick={onOpen} className="group block w-full text-left">
      <div className="card-depth grid aspect-[16/9] grid-cols-4 gap-0.5 overflow-hidden rounded-poster bg-surface transition-transform duration-200 group-hover:scale-[1.02]">
        {posters.length ? (
          posters.map((movie) => (
            <div key={movie.id} className="h-full bg-white/5">
              {movie.posterUrl ? <img src={movie.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
            </div>
          ))
        ) : (
          <div className="col-span-4 grid place-items-center text-muted">
            <ListPlus size={26} />
          </div>
        )}
      </div>
      <p className="mt-2 truncate text-[14px] font-medium text-text group-hover:text-white">{list.name}</p>
      <p className="text-[12px] text-dim tabular">{t("listCount", { n: list.items.length })}</p>
    </button>
  );
}

/** "My list" tab: the saved titles (with Play all / Shuffle) and the profile's custom lists. */
export function MyListPage({
  items,
  hasServer,
  onOpen,
  onPlay,
  onExplore,
}: {
  items: Movie[];
  hasServer: boolean;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  /** Empty list: take the user to Discover. */
  onExplore?: () => void;
}) {
  const { t } = useI18n();
  const { lists, moviesOf, create } = useCustomLists();
  const openSeeAll = useSeeAll();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const add = async () => {
    if (!name.trim()) return;
    const list = await create(name);
    if (list) {
      setName("");
      setAdding(false);
    }
  };

  return (
    <div className="page-enter px-page pt-24 pb-16">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em]">{t("myList")}</h2>
        {items.length ? (
          <div className="flex flex-wrap items-center gap-3">
            <ListActions items={items} onPlay={onPlay} />
          </div>
        ) : null}
      </div>
      {items.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
          {items.map((movie, i) => (
            <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} layout="grid" delay={i * 20} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={t("emptyList")}
          hint={t("emptyListHint")}
          icon={<Compass size={26} />}
          action={onExplore ? { label: t("exploreAction"), icon: <Compass size={16} />, onClick: onExplore } : undefined}
        />
      )}

      <section className="mt-section pt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-[18px] font-semibold">{t("yourLists")}</h2>
          {adding ? (
            <form
              className="flex w-full max-w-[440px] gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <input
                autoFocus
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  setAdding(false);
                }}
                placeholder={t("newListPlaceholder")}
                aria-label={t("newList")}
                className={cn(fieldClass, "min-w-0 flex-1")}
              />
              <Pill variant="primary" type="submit" icon={<Plus size={16} />} disabled={!name.trim()}>
                {t("createList")}
              </Pill>
            </form>
          ) : (
            <Pill variant="tonal" pill icon={<Plus size={16} />} onClick={() => setAdding(true)}>
              {t("newList")}
            </Pill>
          )}
        </div>
        {lists.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-rail">
            {lists.map((list) => {
              // Server items cannot open without the server they came from.
              const movies = moviesOf(list).filter((movie) => hasServer || movie.external);
              return (
                <ListTile
                  key={list.id}
                  list={list}
                  items={movies}
                  onOpen={() => openSeeAll?.({ title: list.name, items: movies, listId: list.id })}
                />
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<ListPlus size={26} />} title={t("noCustomLists")} hint={t("noCustomListsHint")} />
        )}
      </section>
    </div>
  );
}
