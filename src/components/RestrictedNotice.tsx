import { ShieldAlert } from "lucide-react";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { EmptyState } from "./EmptyState";

/**
 * Whole-page notice for a title above the open profile's age limit, reached through a
 * link that skipped the filtered rows (a person, a collection, "continue watching").
 */
export function RestrictedNotice({ leaving, top, onBack }: { leaving?: boolean; top: boolean; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className={cn("absolute inset-0 z-30 grid place-items-center overflow-hidden bg-base px-6 text-text", leaving ? "page-exit" : "page-enter")}
      aria-hidden={!top}
    >
      <EmptyState
        large
        icon={<ShieldAlert size={26} />}
        title={t("parentalBlockedTitle")}
        hint={t("parentalBlockedHint")}
        action={{ label: t("back"), onClick: onBack }}
      />
    </div>
  );
}
