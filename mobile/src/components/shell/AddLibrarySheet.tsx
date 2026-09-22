import React from "react";
import { Film, Tv } from "lucide-react-native";
import type { Library } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { ActionSheet, type SheetAction } from "../ui/ActionSheet";

/**
 * Every library on the server the user has not pinned yet. The "My server" chip
 * already lists every film, so a lone movies library is not offered again
 * (same rule as the desktop header).
 */
export function addableLibraries(available: Library[], pinned: string[]): Library[] {
  const taken = new Set(pinned);
  const movies = available.filter((lib) => lib.collectionType === "movies");
  return available.filter((lib) => !taken.has(lib.id) && !(lib.collectionType === "movies" && movies.length === 1));
}

/** Picker behind the `+` chip: pins one more Jellyfin library to the scope row. */
export function AddLibrarySheet({
  visible,
  onClose,
  available,
  pinned,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  /** Every library the server offers. */
  available: Library[];
  /** Ids already pinned. */
  pinned: string[];
  onPick: (library: Library) => void;
}) {
  const { t } = useI18n();
  const addable = addableLibraries(available, pinned);
  const actions: SheetAction[] = addable.length
    ? addable.map((library) => ({
        key: library.id,
        label: library.name,
        icon: library.collectionType === "tvshows" ? Tv : Film,
        onPress: () => onPick(library),
      }))
    : [{ key: "none", label: t("noMoreLibraries"), disabled: true, onPress: () => undefined }];

  return <ActionSheet visible={visible} onClose={onClose} title={t("addLibrary")} actions={actions} />;
}
