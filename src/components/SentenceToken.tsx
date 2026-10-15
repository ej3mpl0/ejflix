import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useI18n } from "../lib/locale-context";
import { cn } from "../lib/format";

/**
 * One word of a filter written as a sentence ("Quiero ver *series* de *terror*..."): the
 * current value, underlined, that opens its options underneath. `open` is owned by the
 * sentence, so only one word is open at a time.
 */
export function SentenceToken<T extends string>({
  label,
  value,
  options,
  open,
  onOpen,
  onClose,
  onChange,
  columns = false,
}: {
  /** Accessible name of the filter ("Genre"). */
  label: string;
  value: T;
  options: { value: T; label: string }[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: T) => void;
  /** Many short options (years): a dense scrolling grid instead of a wrap. */
  columns?: boolean;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLSpanElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  // A word near the right edge opens its list leftwards, so it never leaves the window.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const box = pop.current?.getBoundingClientRect();
    if (box) setShift(Math.min(0, window.innerWidth - 24 - box.right));
  }, [open]);
  const [query, setQuery] = useState("");
  const current = options.find((option) => option.value === value) ?? options[0];
  // Long lists (genres from many addons, years) get a filter box.
  const searchable = options.length > 10;
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? options.filter((option) => option.label.toLocaleLowerCase().includes(needle)) : options;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    setQuery("");
    // Typing goes to the filter when there is one; otherwise the chosen option takes the focus.
    if (search.current) search.current.focus();
    else root.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus();
    root.current?.querySelector<HTMLElement>("[aria-checked=true]")?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  return (
    <span ref={root} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => (open ? onClose() : onOpen())}
        className={cn(
          "rounded-[10px] text-text decoration-text/45 decoration-dotted decoration-2 underline-offset-[7px] transition-colors duration-150",
          open ? "bg-panel px-2.5 no-underline" : "underline hover:decoration-text",
        )}
      >
        {current?.label}
      </button>
      {open ? (
        <span
          ref={pop}
          style={{ left: shift }}
          className="modal-enter absolute top-[calc(100%+10px)] left-0 z-30 flex w-[min(520px,calc(100vw-48px))] flex-col rounded-card bg-panel p-3 font-sans text-[14px] leading-normal tracking-normal shadow-[0_24px_60px_rgb(0_0_0_/_0.6)]"
          // The wheel scrolls this list, not the page behind it.
          onWheel={(e) => e.stopPropagation()}
        >
          {searchable ? (
            <span className="relative mb-2.5 flex shrink-0 items-center">
              <Search size={15} className="pointer-events-none absolute left-3 text-dim" aria-hidden />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shown[0]) {
                    e.preventDefault();
                    onChange(shown[0].value);
                    onClose();
                  }
                }}
                placeholder={t("searchIn", { what: label.toLowerCase() })}
                aria-label={t("searchIn", { what: label.toLowerCase() })}
                className="field-own-focus h-10 w-full rounded-pill bg-line pr-4 pl-9 text-[14px] text-text outline-none placeholder:text-dim focus:shadow-[inset_0_0_0_2px_var(--color-text)]"
              />
            </span>
          ) : null}
          <span
            role="radiogroup"
            aria-label={label}
            className={cn(
              "max-h-[min(340px,50vh)] overflow-y-auto overscroll-contain",
              columns ? "grid grid-cols-5 gap-1.5" : "flex flex-wrap gap-2",
            )}
          >
            {shown.length ? (
              shown.map((option) => {
                const on = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      onChange(option.value);
                      onClose();
                    }}
                    className={cn(
                      "inline-flex h-9 items-center justify-center rounded-pill px-3.5 font-medium whitespace-nowrap transition-colors duration-150",
                      on ? "bg-accent font-semibold text-on-accent" : "bg-line text-text hover:bg-white/16",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })
            ) : (
              <span className="px-1 py-2 text-[13.5px] text-muted">{t("noResults")}</span>
            )}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Fills `{name}` holes of a translated sentence with nodes (the tokens). */
export function fillSentence(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((piece, i) => {
    const match = /^\{(\w+)\}$/.exec(piece);
    return <Fragment key={i}>{match ? parts[match[1]] : piece}</Fragment>;
  });
}
