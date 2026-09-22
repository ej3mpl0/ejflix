import React, { memo, useCallback, useRef, useState } from "react";
import { FlatList, Pressable, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { Movie } from "../../lib/types";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { PosterCard } from "./PosterCard";
import { ContinueCard } from "./ContinueCard";
import { ItemActionSheet } from "./ItemActionSheet";
import { ChevronRight } from "lucide-react-native";
import { useI18n } from "../../lib/locale-context";
import { openSeeAll } from "../../navigation/navigationRef";

export type PosterRowVariant = "poster" | "continue" | "nextUp";

export type PosterRowProps = {
  title: string;
  items: Movie[];
  variant?: PosterRowVariant;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  /** Long-press handler; when absent the row hosts one `ItemActionSheet`. */
  onMenu?: (movie: Movie) => void;
  /** IMDb id of the parent series (episode rows offering online sources). */
  seriesImdb?: string | null;
  /** Addon catalog behind the row, so its "See all" grid can keep paging. */
  catalog?: { addonUrl: string; type: string; id: string };
  style?: StyleProp<ViewStyle>;
};

const FADE_W = 36;

function PosterRowInner({ title, items, variant = "poster", onOpen, onPlay, onMenu, seriesImdb, catalog, style }: PosterRowProps) {
  const { t: tr } = useI18n();
  const s = useStyles();
  const t = useTheme();
  const layout = useLayout();
  const wide = variant !== "poster";
  const itemW = wide ? layout.contW : layout.posterW;
  const step = itemW + layout.rail;
  const [atEnd, setAtEnd] = useState(false);
  const [menu, setMenu] = useState<Movie | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const fits = useRef(false);

  const openMenu = useCallback(
    (movie: Movie) => {
      if (onMenu) {
        onMenu(movie);
        return;
      }
      setMenu(movie);
      setMenuOpen(true);
    },
    [onMenu],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const end = contentOffset.x + layoutMeasurement.width >= contentSize.width - 4;
    setAtEnd(end);
  }, []);

  const onContentSizeChange = useCallback(
    (w: number) => {
      fits.current = w <= layout.width;
      setAtEnd(fits.current);
    },
    [layout.width],
  );

  const renderItem = useCallback(
    ({ item }: { item: Movie }) =>
      wide ? (
        <ContinueCard movie={item} width={itemW} onPlay={onPlay} onOpen={onOpen} onMenu={openMenu} variant={variant === "nextUp" ? "nextUp" : "resume"} />
      ) : (
        <PosterCard movie={item} width={itemW} onOpen={onOpen} onPlay={onPlay} onMenu={openMenu} />
      ),
    [wide, itemW, onPlay, onOpen, openMenu, variant],
  );

  if (!items.length) return null;

  return (
    <View style={[s.section, style]}>
      <View style={[s.head, { paddingHorizontal: layout.pagePad }]}>
        <Text numberOfLines={1} style={[s.title, { flexShrink: 1 }]}>
          {title}
        </Text>
        {variant === "poster" && (items.length >= 8 || catalog) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${tr("seeAll")}: ${title}`}
            hitSlop={10}
            onPress={() => openSeeAll(title, items, catalog)}
            style={s.seeAll}
          >
            <Text style={s.seeAllText}>{tr("seeAll")}</Text>
            <ChevronRight size={15} color={t.colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <View>
        <FlatList
          horizontal
          data={items}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: layout.pagePad, gap: layout.rail, paddingTop: 4, paddingBottom: 6 }}
          snapToInterval={step}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum={false}
          initialNumToRender={Math.ceil(layout.width / step) + 2}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews
          getItemLayout={(_, index) => ({ length: step, offset: layout.pagePad + index * step, index })}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onContentSizeChange={onContentSizeChange}
          extraData={itemW}
        />
        {!atEnd ? (
          <LinearGradient
            pointerEvents="none"
            colors={["transparent", t.colors.base]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[s.fade, { width: FADE_W }]}
          />
        ) : null}
      </View>
      {!onMenu ? (
        <ItemActionSheet movie={menu} visible={menuOpen} onClose={() => setMenuOpen(false)} onOpen={onOpen} onPlay={onPlay} seriesImdb={seriesImdb} />
      ) : null}
    </View>
  );
}

/** Titled horizontal rail of posters or 16:9 continue cards, snapping to the card grid. */
export const PosterRow = memo(PosterRowInner);

const useStyles = makeStyles((t) => ({
  section: { paddingVertical: 4 },
  title: { ...text(18, "semibold", { tracking: -0.01 }), color: t.colors.text },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeAllText: { ...text(13, "semibold"), color: t.colors.muted },
  fade: { position: "absolute", top: 0, bottom: 0, right: 0 },
}));

