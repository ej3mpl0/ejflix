import { useEffect, useRef, useState } from "react";
import { Search, User, X } from "lucide-react";
import type { Person } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { Chip } from "./Chip";

const DEBOUNCE_MS = 250;

/**
 * Discover's actor / director filter: type a name, pick someone from the library's
 * people, and the chosen person stays as a chip until cleared.
 */
export function PersonFilter({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (person: { id: string; name: string } | null) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const handle = window.setTimeout(() => {
      api
        .searchPeople(text)
        .then((list) => {
          if (!alive) return;
          setResults(list);
          setActive(0);
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (value) {
    return (
      <Chip selected icon={<User size={14} />} onClick={() => onChange(null)} aria-label={`${t("clearPerson")}: ${value.name}`} title={t("clearPerson")}>
        <span className="max-w-[180px] truncate">{value.name}</span>
        <X size={14} />
      </Chip>
    );
  }

  const pick = (person: Person) => {
    onChange({ id: person.id, name: person.name });
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const shown = open && results.length > 0;

  return (
    <div ref={root} className="relative">
      <label className="flex h-10 w-[210px] items-center gap-2 rounded-pill border border-white/10 bg-white/6 pl-3 transition-colors focus-within:border-accent/60 focus-within:bg-white/10">
        <Search size={14} className="shrink-0 text-dim" aria-hidden />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!shown) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((i) => (i + step + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === "Escape") {
              // Closes the list, not the tab.
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder={t("filterPerson")}
          aria-label={t("filterPerson")}
          role="combobox"
          aria-expanded={shown}
          aria-controls="person-filter-list"
          aria-autocomplete="list"
          className="field-own-focus h-full min-w-0 flex-1 bg-transparent pr-3 text-[13px] text-text outline-none placeholder:text-dim"
        />
      </label>
      {shown ? (
        <div
          id="person-filter-list"
          role="listbox"
          className="modal-enter absolute top-12 left-0 z-20 max-h-[320px] w-[260px] overflow-y-auto rounded-2xl bg-panel/95 p-1.5 shadow-[0_16px_40px_rgb(0_0_0_/_0.55),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md"
        >
          {results.map((person, i) => (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(person)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
                i === active ? "bg-white/8 text-text" : "text-text/85",
              )}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white/8 text-[12px] font-semibold text-muted">
                {person.imageUrl ? <img src={person.imageUrl} alt="" className="h-full w-full object-cover" /> : person.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
