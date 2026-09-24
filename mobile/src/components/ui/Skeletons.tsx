import React from "react";
import { View } from "react-native";
import { useLayout } from "../../theme/responsive";
import { useTheme } from "../../theme/ThemeProvider";
import { Shimmer } from "./Shimmer";

/** Home hero placeholder: full-bleed shimmer with title / meta / action ghosts. */
export function HeroSkeleton() {
  const l = useLayout();
  const t = useTheme();
  const titleW = Math.min(420, l.width * 0.6);
  return (
    <View style={{ height: l.heroH, backgroundColor: t.colors.surface, borderBottomLeftRadius: t.radii.hero, borderBottomRightRadius: t.radii.hero, overflow: "hidden" }}>
      <Shimmer style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 0, backgroundColor: "transparent" }} />
      <View style={{ position: "absolute", left: l.pagePad, right: l.pagePad, bottom: 40, gap: 14 }}>
        <Shimmer width={titleW} height={l.sizeClass === "compact" ? 44 : 64} radius={10} />
        <Shimmer width={Math.min(256, l.width * 0.5)} height={14} radius={4} />
        <Shimmer width={Math.min(460, l.width * 0.7)} height={14} radius={4} />
        <View style={{ flexDirection: "row", gap: 12, paddingTop: 6 }}>
          <Shimmer width={144} height={48} radius={t.radii.pill} />
          <Shimmer width={160} height={48} radius={t.radii.pill} />
        </View>
      </View>
    </View>
  );
}

/** One poster rail: a title ghost and eight posters (2:3). */
export function RowSkeleton({ count = 8 }: { count?: number }) {
  const l = useLayout();
  const t = useTheme();
  const visible = Math.min(count, Math.ceil(l.width / (l.posterW + l.rail)) + 1);
  return (
    <View style={{ paddingHorizontal: l.pagePad, paddingVertical: 12 }}>
      <Shimmer width={192} height={20} radius={5} style={{ marginBottom: 14 }} />
      <View style={{ flexDirection: "row", gap: l.rail, overflow: "hidden" }}>
        {Array.from({ length: visible }).map((_, i) => (
          <View key={i} style={{ width: l.posterW }}>
            <Shimmer width={l.posterW} height={l.posterH} radius={t.radii.poster} delay={i * 80} />
            <Shimmer width="75%" height={14} radius={4} delay={i * 80} style={{ marginTop: 8 }} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Continue-watching rail: 16:9 cards. */
export function WideRowSkeleton({ count = 4 }: { count?: number }) {
  const l = useLayout();
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: l.pagePad, paddingVertical: 12 }}>
      <Shimmer width={192} height={20} radius={5} style={{ marginBottom: 14 }} />
      <View style={{ flexDirection: "row", gap: l.rail, overflow: "hidden" }}>
        {Array.from({ length: count }).map((_, i) => (
          <Shimmer key={i} width={l.contW} height={Math.round((l.contW * 9) / 16)} radius={t.radii.poster} delay={i * 80} />
        ))}
      </View>
    </View>
  );
}

/** Details page placeholder: backdrop, title, meta, actions and a cast row. */
export function DetailsSkeleton() {
  const l = useLayout();
  const t = useTheme();
  const backdropH = Math.max(320, Math.round(l.height * 0.5));
  return (
    <View>
      <View style={{ height: backdropH, backgroundColor: t.colors.surface, overflow: "hidden" }}>
        <Shimmer style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 0, backgroundColor: "transparent" }} />
        <View style={{ position: "absolute", left: l.pagePad, right: l.pagePad, bottom: 32, gap: 14 }}>
          <Shimmer width={Math.min(380, l.width * 0.6)} height={l.sizeClass === "compact" ? 40 : 56} radius={10} />
          <Shimmer width={224} height={14} radius={4} />
          <View style={{ flexDirection: "row", gap: 12, paddingTop: 6 }}>
            <Shimmer width={144} height={48} radius={t.radii.pill} />
            <Shimmer width={128} height={48} radius={t.radii.pill} />
          </View>
        </View>
      </View>
      <View style={{ paddingHorizontal: l.pagePad, paddingVertical: 28, gap: 14 }}>
        <Shimmer width="70%" height={14} radius={4} />
        <Shimmer width="60%" height={14} radius={4} />
        <View style={{ flexDirection: "row", gap: 16, paddingTop: 12, overflow: "hidden" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} width={72} height={72} radius={36} delay={i * 80} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** Episode list placeholder: thumb + three lines. */
export function EpisodeListSkeleton({ count = 4 }: { count?: number }) {
  const l = useLayout();
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 14, padding: 8 }}>
          <Shimmer width={l.thumbW} height={Math.round((l.thumbW * 9) / 16)} radius={t.radii.poster} delay={i * 80} />
          <View style={{ flex: 1, gap: 8, paddingVertical: 6 }}>
            <Shimmer width="50%" height={14} radius={4} />
            <Shimmer width="85%" height={12} radius={4} />
            <Shimmer width="65%" height={12} radius={4} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Poster grid placeholder (search / discover / library). */
export function GridSkeleton({ rows = 2 }: { rows?: number }) {
  const l = useLayout();
  const t = useTheme();
  const { cols, itemW } = l.grid();
  return (
    <View style={{ paddingHorizontal: l.pagePad, flexDirection: "row", flexWrap: "wrap", gap: l.rail }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <Shimmer key={i} width={itemW} height={Math.round(itemW * 1.5)} radius={t.radii.poster} delay={(i % cols) * 80} />
      ))}
    </View>
  );
}

/** Live TV tiles placeholder: 16:9 plates with a name line, in the grid's own geometry. */
export function ChannelGridSkeleton({ cols, itemW, gap, rows = 3 }: { cols: number; itemW: number; gap: number; rows?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <View key={i} style={{ width: itemW }}>
          <Shimmer width={itemW} height={Math.round((itemW * 9) / 16)} radius={t.radii.poster} delay={(i % cols) * 60} />
          <Shimmer width={Math.round(itemW * 0.7)} height={12} radius={6} delay={(i % cols) * 60} style={{ marginTop: 8 }} />
        </View>
      ))}
    </View>
  );
}

/** Navigation rows (the Live TV groups) while they load. */
export function NavListSkeleton({ count = 8 }: { count?: number }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Shimmer
          key={i}
          width={`${55 + ((i * 17) % 35)}%`}
          height={14}
          radius={t.radii.btn}
          delay={i * 50}
          style={{ marginVertical: 15 }}
        />
      ))}
    </View>
  );
}
