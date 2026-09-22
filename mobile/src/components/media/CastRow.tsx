import React, { useCallback } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type { Person } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";

const AVATAR = 88;
const ITEM_W = 104;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

/** Circular cast avatars with name and role (Nuvio style). Bleeds to the page edges. */
export function CastRow({ people, title }: { people: Person[]; title?: string }) {
  const s = useStyles();
  const { t } = useI18n();
  const { pagePad } = useLayout();

  const renderItem = useCallback(
    ({ item }: { item: Person }) => (
      <View style={s.item}>
        <View style={s.avatar}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} contentFit="cover" transition={300} cachePolicy="memory-disk" recyclingKey={item.id} style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={s.initials}>{initials(item.name)}</Text>
          )}
          <View pointerEvents="none" style={s.outline} />
        </View>
        <Text numberOfLines={2} style={s.name}>
          {item.name}
        </Text>
        {item.role ? (
          <Text numberOfLines={2} style={s.role}>
            {item.role}
          </Text>
        ) : null}
      </View>
    ),
    [s],
  );

  if (!people.length) return null;
  return (
    <View style={{ marginHorizontal: -pagePad }}>
      <Text style={[s.heading, { paddingHorizontal: pagePad }]}>{title ?? t("cast")}</Text>
      <FlatList
        horizontal
        data={people}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: pagePad, gap: 12 }}
        initialNumToRender={8}
        getItemLayout={(_, index) => ({ length: ITEM_W + 12, offset: pagePad + index * (ITEM_W + 12), index })}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  heading: { ...text(18, "semibold", { tracking: -0.01 }), color: t.colors.text, marginBottom: 14 },
  item: { width: ITEM_W, alignItems: "center" },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: t.colors.panel,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  outline: { ...StyleSheet.absoluteFill, borderRadius: AVATAR / 2, borderWidth: 1, borderColor: t.outline },
  initials: { ...text(22, "semibold"), color: t.colors.muted },
  name: { ...text(13, "medium", { lineHeight: 17 }), color: t.colors.text, textAlign: "center", marginTop: 8 },
  role: { ...text(11, "regular", { lineHeight: 14 }), color: t.colors.dim, textAlign: "center", marginTop: 2 },
}));
