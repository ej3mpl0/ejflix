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
import { Chip } from "../components/Chip";
import { Select } from "../components/Select";
import { useUserData } from "../lib/userdata-context";

/** A list as a shelf: its last three covers fanned out, its name and size. */
function Shelf({
  name,
  count,
  items,
  active,
  onSelect,
}: {
  name: string;
  count: string;
  items: Movie[];
  active: boolean;
  onSelect: () => void;
}) {
  const covers = items.filter((movie) => movie.posterUrl).slice(0, 3);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "group w-[236px] shrink-0 rounded-card p-4 text-left transition-colors duration-150",
        active ? "bg-panel shadow-[inset_0_0_0_2px_var(--color-text)]" : "bg-surface hover:bg-panel",
      )}
    >
      <span className="relative mb-3 block h-[118px]">
        {covers.length ? (
          covers.map((movie, i) => (
            <img
              key={movie.id}
              src={movie.posterUrl ?? ""}
              alt=""
              loading="lazy"
              className={cn(
                "absolute bottom-0 rounded-md object-cover shadow-[0_8px_20px_rgb(0_0_0_/_0.5)] transition-transform duration-200 ease-std",
                i === 1 ? "left-[62px] z-[2] h-[116px] w-[78px]" : "h-[108px] w-[72px]",
                i === 0 && "left-2 -rotate-[7deg] group-hover:-rotate-[10deg]",
                i === 2 && "left-[124px] rotate-[7deg] group-hover:rotate-[10deg]",
              )}
            />
          ))
        ) : (
          <span className="grid h-full place-items-center rounded-md bg-white/5 text-muted">
            <ListPlus size={26} />
          </span>
        )}
      </span>
      <span className="block truncate font-display text-[16px] font-semibold">{name}</span>
      <span className="block text-[13px] text-muted tabular">{count}</span>
    </button>
  );
}

type Kind = "all" | "movies" | "series" | "unwatched";
type Order = "added" | "name" | "year";

/** "My list" tab: the saved titles and the custom lists, as shelves; the chosen one fills the grid. */
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
  const { flags } = useUserData();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [shelf, setShelf] = useState<string>("all");
  const [kind, setKind] = useState<Kind>("all");
  const [order, setOrder] = useState<Order>("added");

  const add = async () => {
    if (!name.trim()) return;
    const list = await create(name);
    if (list) {
      setName("");
      setAdding(false);
      setShelf(list.id);
    }
  };

  // Server items cannot open without the server they came from.
  const listMovies = (list: CustomList) => moviesOf(list).filter((movie) => hasServer || movie.external);
  const current = lists.find((list) => list.id === shelf) ?? null;
  const source = current ? listMovies(current) : items;
  const isSeries = (movie: Movie) => movie.kind === "Series" || movie.kind === "Episode";
  const counts = {
    all: source.length,
    movies: source.filter((movie) => !isSeries(movie)).length,
    series: source.filter(isSeries).length,
  };
  const shown = source
    .filter((movie) =>
      kind === "movies" ? !isSeries(movie) : kind === "series" ? isSeries(movie) : kind === "unwatched" ? !flags(movie).played : true,
    )
    .slice();
  if (order === "name") shown.sort((a, b) => a.name.localeCompare(b.name));
  if (order === "year") shown.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  return (
    <div className="page-enter px-page pt-28 pb-16">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[40px] leading-none font-extrabold tracking-[-0.025em]">{t("myList")}</h1>
        <div className="flex flex-wrap items-center gap-3">
          {shown.length ? <ListActions items={shown} onPlay={onPlay} /> : null}
          {adding ? (
            <form
              className="flex w-[min(400px,100%)] gap-2"
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
            <Pill variant="tonal" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
              {t("newList")}
            </Pill>
          )}
        </div>
      </div>

      <div className="no-scrollbar -mx-page mb-8 flex gap-4 overflow-x-auto px-page pb-1" role="group" aria-label={t("yourLists")}>
        <Shelf
          name={t("shelfAll")}
          count={t("listCount", { n: items.length })}
          items={items.slice(0, 3)}
          active={!current}
          onSelect={() => setShelf("all")}
        />
        {lists.map((list) => {
          const movies = listMovies(list);
          return (
            <Shelf
              key={list.id}
              name={list.name}
              count={t("listCount", { n: list.items.length })}
              items={movies.slice(-3).reverse()}
              active={current?.id === list.id}
              onSelect={() => setShelf(list.id)}
            />
          );
        })}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-[236px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-card border-2 border-dashed border-line text-[14px] font-semibold text-muted transition-colors duration-150 hover:border-white/30 hover:text-text"
        >
          <Plus size={28} />
          {t("newList")}
        </button>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", t("sourceAll"), counts.all],
            ["movies", t("movies"), counts.movies],
            ["series", t("series"), counts.series],
            ["unwatched", t("unwatched"), null],
          ] as const
        ).map(([value, label, n]) => (
          <Chip key={value} selected={kind === value} onClick={() => setKind(value)}>
            {label}
            {n != null ? <span className="text-[12px] opacity-70 tabular">{n}</span> : null}
          </Chip>
        ))}
        <span className="ml-auto flex items-center gap-3">
          {current ? (
            <button
              type="button"
              onClick={() => openSeeAll?.({ title: current.name, items: listMovies(current), listId: current.id })}
              className="text-[14px] font-semibold text-text hover:underline"
            >
              {t("manageList")}
            </button>
          ) : null}
          <Select<Order>
            label={t("sortBy")}
            value={order}
            onChange={setOrder}
            variant="pill"
            options={[
              { value: "added", label: t("sortAdded") },
              { value: "name", label: t("sortName") },
              { value: "year", label: t("sortYear") },
            ]}
          />
        </span>
      </div>

      {shown.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-x-4 gap-y-2">
          {shown.map((movie, i) => (
            <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} layout="grid" delay={Math.min(i, 24) * 20} />
          ))}
        </div>
      ) : current ? (
        <EmptyState icon={<ListPlus size={26} />} title={t("emptyCustomList")} hint={t("noCustomListsHint")} />
      ) : (
        <EmptyState
          title={t("emptyList")}
          hint={t("emptyListHint")}
          icon={<Compass size={26} />}
          action={onExplore ? { label: t("exploreAction"), icon: <Compass size={16} />, onClick: onExplore } : undefined}
        />
      )}
    </div>
  );
}
