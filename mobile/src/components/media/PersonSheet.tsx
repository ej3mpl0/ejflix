import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { Movie, Person } from "../../lib/types";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Sheet } from "../ui/Sheet";
import { EmptyCard } from "../ui/EmptyCard";
import { Shimmer } from "../ui/Shimmer";
import { PosterGrid } from "./PosterGrid";

/** A cast or crew member of a Jellyfin title: what of theirs is in the library. */
export function PersonSheet({
  person,
  onClose,
  onOpen,
  onPlay,
}: {
  person: Person | null;
  onClose: () => void;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const [items, setItems] = useState<Movie[] | null>(null);
  const [error, setError] = useState("");
  const id = person?.id ?? null;

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setItems(null);
    setError("");
    api
      .personItems(id)
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <Sheet visible={person != null} onClose={onClose} snap={0.86} title={person?.name} contentStyle={{ flex: 1 }}>
      <Text style={s.kicker}>{t("personInLibrary")}</Text>
      {error ? (
        <EmptyCard title={t("cannotConnect")} hint={error} style={s.pad} />
      ) : items == null ? (
        <View style={[s.pad, s.shimmers]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} width={104} height={156} radius={12} delay={i * 60} />
          ))}
        </View>
      ) : (
        <PosterGrid
          items={items}
          onOpen={(movie) => {
            onClose();
            onOpen(movie);
          }}
          onPlay={onPlay}
          minWidth={104}
          empty={<EmptyCard title={t("personNothing")} style={s.pad} />}
          style={{ flex: 1 }}
        />
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  kicker: { ...text(12), color: t.colors.dim, paddingHorizontal: 20, marginBottom: 12 },
  pad: { marginHorizontal: 20 },
  shimmers: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
}));
