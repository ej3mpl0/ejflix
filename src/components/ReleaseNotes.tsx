import { useI18n } from "../lib/locale-context";
import { RELEASE_NOTE_KEYS } from "../lib/i18n";

/** What's new in this version (shown by the update modal and in Settings › Account). */
export function ReleaseNotes({ className }: { className?: string }) {
  const { t } = useI18n();
  const notes = RELEASE_NOTE_KEYS.map((key) => t(key));
  return (
    <ul className={className ?? "space-y-2.5 text-[15px] leading-[1.6] text-muted"}>
      {notes.map((note) => (
        <li key={note} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span>{note}</span>
        </li>
      ))}
    </ul>
  );
}
