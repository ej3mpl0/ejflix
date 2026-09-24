import { useState, type ReactNode } from "react";
import { Check, Heart, Plus, X } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn } from "../lib/format";
import { fieldClass } from "../lib/ui";
import { useI18n } from "../lib/locale-context";
import { useUserData } from "../lib/userdata-context";
import { useCustomLists } from "../lib/lists-context";
import { Dialog } from "./Dialog";

/** One toggle row of the dialog: a list and whether the title is in it. */
function ListToggle({
  label,
  hint,
  icon,
  on,
  busy,
  onToggle,
}: {
  label: string;
  hint?: string;
  icon?: ReactNode;
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      disabled={busy}
      onClick={onToggle}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors duration-150 hover:bg-white/6 disabled:opacity-60"
    >
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors duration-150",
          on ? "border-accent bg-accent text-on-accent" : "border-white/25 text-transparent",
        )}
      >
        <Check size={15} strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 truncate text-[14px] font-medium text-text">
          {icon}
          {label}
        </span>
        {hint ? <span className="block text-[12px] text-dim tabular">{hint}</span> : null}
      </span>
    </button>
  );
}

/** "Add to a list": My list plus every custom list, with a field to start a new one. */
export function ListPickerDialog({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  const { t } = useI18n();
  const { flags, setFavorite, pending } = useUserData();
  const { lists, listsWith, setItem, create } = useCustomLists();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const inLists = new Set(listsWith(movie));
  const favorite = flags(movie).favorite;

  const toggle = async (id: string, on: boolean) => {
    setBusy(id);
    try {
      await setItem(id, movie, on);
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy("new");
    try {
      const list = await create(trimmed);
      if (list) {
        setName("");
        await setItem(list.id, movie, true);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      labelledBy="list-picker-title"
      onEscape={onClose}
      onBackdrop={onClose}
      z="z-[80]"
      className="flex max-h-[80vh] w-[min(440px,94vw)] flex-col overflow-hidden rounded-card bg-surface shadow-[0_24px_80px_rgb(0_0_0_/_0.55)]"
    >
      <div className="flex items-start gap-3 px-6 pt-6 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id="list-picker-title" className="text-[18px] font-semibold">
            {t("addToLists")}
          </h2>
          <p className="truncate text-[13px] text-dim">{movie.kind === "Episode" && movie.seriesName ? `${movie.seriesName} · ${movie.name}` : movie.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10"
        >
          <X size={18} />
        </button>
      </div>
      <div role="menu" aria-labelledby="list-picker-title" className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <ListToggle
          label={t("myList")}
          icon={<Heart size={14} className="text-accent" />}
          on={favorite}
          busy={pending(movie.id)}
          onToggle={() => void setFavorite(movie, !favorite)}
        />
        {lists.map((list) => (
          <ListToggle
            key={list.id}
            label={list.name}
            hint={t("listCount", { n: list.items.length })}
            on={inLists.has(list.id)}
            busy={busy === list.id}
            onToggle={() => void toggle(list.id, !inLists.has(list.id))}
          />
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-white/8 px-6 pt-4 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          data-autofocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("newListPlaceholder")}
          aria-label={t("newList")}
          className={cn(fieldClass, "min-w-0 flex-1")}
        />
        <button
          type="submit"
          disabled={busy === "new" || !name.trim()}
          className="btn-press inline-flex h-11 shrink-0 items-center gap-2 rounded-btn bg-accent px-4 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          <Plus size={16} />
          {t("createList")}
        </button>
      </form>
    </Dialog>
  );
}
