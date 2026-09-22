import React, { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import type { Movie } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { usePlay } from "../lib/play";
import { openDetails } from "../navigation/navigationRef";
import type { MainScreenProps } from "../navigation/types";
import { makeStyles } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { PosterGrid } from "../components/media/PosterGrid";
import { FloatingTitleBar } from "../components/shell";
import { Spinner } from "../components/ui/Spinner";

/** A Home row as a full grid ("See all"); an addon catalog keeps paging in as you scroll. */
export function SeeAllScreen({ route, navigation }: MainScreenProps<"SeeAll">) {
  const { title, items: seed, catalog } = route.params;
  const s = useStyles();
  const layout = useLayout();
  const play = usePlay();
  const [items, setItems] = useState<Movie[]>(seed);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!catalog);
  const busy = useRef(false);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const more = useCallback(async () => {
    if (!catalog || done || busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const metas = await api.addonCatalog({ addonUrl: catalog.addonUrl, type: catalog.type, id: catalog.id, skip: items.length });
      const known = new Set(items.map((m) => m.id));
      const fresh = metas.map(metaToMovie).filter((m) => !known.has(m.id));
      if (!fresh.length) setDone(true);
      else setItems((current) => [...current, ...fresh]);
    } catch {
      setDone(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [catalog, done, items]);

  return (
    <View style={s.root}>
      <PosterGrid
        items={items}
        onOpen={openDetails}
        onPlay={play}
        onScroll={onScroll}
        onEndReached={() => void more()}
        onEndReachedThreshold={0.6}
        header={
          <View style={{ paddingTop: layout.insets.top + 64, paddingBottom: 16 }}>
            <Text style={s.title}>{title}</Text>
          </View>
        }
        footer={
          loading ? (
            <View style={{ alignItems: "center", marginVertical: 20 }}>
              <Spinner size={28} />
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: layout.insets.bottom + 32 }}
      />
      <FloatingTitleBar title={title} scrollY={scrollY} onBack={() => navigation.goBack()} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  title: { ...text(24, "semibold", { tracking: -0.01 }), color: t.colors.text },
}));
