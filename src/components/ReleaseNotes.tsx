import { useI18n } from "../lib/locale-context";

/** What's new in this version (shown by the update modal and in Settings › Account). */
export function ReleaseNotes({ className }: { className?: string }) {
  const { t } = useI18n();
  const notes = [t("note15"), t("note14"), t("note13"), t("note12"), t("note11"), t("note10"), t("note9"), t("note8"), t("note7"), t("note6"), t("note5"), t("note4"), t("note3"), t("note2"), t("note1")];
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
