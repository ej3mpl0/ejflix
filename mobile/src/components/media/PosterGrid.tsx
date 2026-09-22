import React, { memo, useCallback, useMemo, useState } from "react";
import { View, type FlatListProps, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import type { Movie } from "../../lib/types";
import { useLayout } from "../../theme/responsive";
import { PosterCard } from "./PosterCard";
import { ItemActionSheet } from "./ItemActionSheet";

type ListProps = FlatListProps<Movie>;

export type PosterGridProps = {
  items: Movie[];
  onOpen: (movie: Movie) => void;
  onPlay?: (movie: Movie) => void;
  /** Long-press; when absent the grid hosts one `ItemActionSheet`. */
  onMenu?: (movie: Movie) => void;
  /** Minimum poster width used to pick the column count (defaults to the layout minimum). */
  minWidth?: number;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  /** Rendered instead of the rows when `items` is empty. */
  empty?: React.ReactElement | null;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  /** Extra padding around the rows (page padding is applied already). */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Reanimated scroll handler or a plain callback. */
  onScroll?: React.ComponentProps<typeof Animated.FlatList>["onScroll"];
  refreshControl?: ListProps["refreshControl"];
  scrollEnabled?: boolean;
  keyboardShouldPersistTaps?: ListProps["keyboardShouldPersistTaps"];
  keyboardDismissMode?: ListProps["keyboardDismissMode"];
  style?: StyleProp<ViewStyle>;
  /** Forces a re-render of the rows (e.g. a user-data version). */
  extraData?: unknown;
};

function PosterGridInner({
  items,
  onOpen,
  onPlay,
  onMenu,
  minWidth,
  header,
  footer,
  empty,
  onEndReached,
  onEndReachedThreshold = 0.6,
  contentContainerStyle,
  onScroll,
  refreshControl,
  scrollEnabled,
  keyboardShouldPersistTaps,
  keyboardDismissMode,
  style,
  extraData,
}: PosterGridProps) {
  const layout = useLayout();
  const { cols, itemW } = layout.grid(minWidth);
  const [menu, setMenu] = useState<Movie | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const renderItem = useCallback(
    ({ item }: { item: Movie }) => <PosterCard movie={item} width={itemW} onOpen={onOpen} onPlay={onPlay} onMenu={openMenu} />,
    [itemW, onOpen, onPlay, openMenu],
  );

  const columnWrapperStyle = useMemo(() => ({ gap: layout.rail }), [layout.rail]);
  const contentStyle = useMemo(
    () => [{ paddingHorizontal: layout.pagePad, rowGap: layout.rail + 6 }, contentContainerStyle],
    [layout.pagePad, layout.rail, contentContainerStyle],
  );

  return (
    <>
      <Animated.FlatList
        key={`grid-${cols}`}
        data={items}
        keyExtractor={(m: Movie) => m.id}
        renderItem={renderItem}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? columnWrapperStyle : undefined}
        contentContainerStyle={contentStyle}
        ListHeaderComponent={header ?? undefined}
        ListFooterComponent={footer ?? undefined}
        ListEmptyComponent={empty ?? undefined}
        onEndReached={onEndReached}
        onEndReachedThreshold={onEndReachedThreshold}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={refreshControl}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        showsVerticalScrollIndicator={false}
        initialNumToRender={cols * 4}
        maxToRenderPerBatch={cols * 3}
        windowSize={7}
        removeClippedSubviews
        extraData={extraData ?? itemW}
        style={style}
      />
      {!onMenu ? (
        <View>
          <ItemActionSheet movie={menu} visible={menuOpen} onClose={() => setMenuOpen(false)} onOpen={onOpen} onPlay={onPlay} />
        </View>
      ) : null}
    </>
  );
}

/** Responsive poster grid (search, discover, library, My list): columns from the layout. */
export const PosterGrid = memo(PosterGridInner);
