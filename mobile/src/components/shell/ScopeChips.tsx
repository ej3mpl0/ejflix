import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { haptic } from "../../lib/haptics";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Plus, X } from "lucide-react-native";
import type { Library } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { ActionSheet } from "../ui/ActionSheet";
import { IconButton } from "../ui/IconButton";
import { PressableScale } from "../ui/PressableScale";
import { AddLibrarySheet } from "./AddLibrarySheet";

/** `lib:<id>` browses one pinned Jellyfin library. */
export type Scope = "home" | "myserver" | "mylist" | `lib:${string}`;

export function libraryScope(id: string): Scope {
  return `lib:${id}`;
}

export function scopeLibraryId(scope: Scope): string | null {
  return scope.startsWith("lib:") ? scope.slice(4) : null;
}

/** True for the scopes that only exist with a linked server. */
export function isServerScope(scope: Scope): boolean {
  return scope !== "home";
}

/** Height of the chip row (the underline lives inside it). */
export const SCOPE_ROW_HEIGHT = 48;

const CHIP_H = 44;
const EASE = Easing.bezier(0.2, 0, 0, 1);
const LONG_PRESS_MS = 400;

type Tab = { key: Scope; label: string; library: Library | null };

/**
 * Home scopes (port of the desktop header tabs): Home · My server · one chip per
 * pinned library · My list, plus a `+` that pins another library. The accent
 * underline slides between chips with the desktop `jelly` squash; a long press on a
 * library chip offers to unpin it.
 */
export function ScopeChips({
  scope,
  onScope,
  libraries,
}: {
  scope: Scope;
  onScope: (scope: Scope) => void;
  /** Every library the server offers. */
  libraries: Library[];
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { pagePad } = useLayout();
  const { settings, update } = useSettings();
  const reduced = useReducedMotion();
  const scroller = useRef<ScrollView>(null);
  const [spots, setSpots] = useState<Record<string, { x: number; w: number }>>({});
  const [add, setAdd] = useState(false);
  const [menu, setMenu] = useState<Library | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pinned = settings.library.pinned;

  const left = useSharedValue(0);
  const width = useSharedValue(0);
  const jelly = useSharedValue(0);
  const placed = useRef(false);
  const first = useRef(true);

  const tabs = useMemo<Tab[]>(() => {
    const list: Tab[] = [
      { key: "home", label: tr("home"), library: null },
      { key: "myserver", label: tr("myServer"), library: null },
    ];
    for (const id of pinned) {
      const library = libraries.find((lib) => lib.id === id);
      if (library) list.push({ key: libraryScope(library.id), label: library.name, library });
    }
    list.push({ key: "mylist", label: tr("myList"), library: null });
    return list;
  }, [pinned, libraries, tr]);

  const measure = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      const { x, width: w } = e.nativeEvent.layout;
      setSpots((current) => {
        const previous = current[key];
        if (previous && Math.abs(previous.x - x) < 0.5 && Math.abs(previous.w - w) < 0.5) return current;
        return { ...current, [key]: { x, w } };
      });
    },
    [],
  );

  // Underline follows the active chip; the first placement jumps, later ones glide.
  const spot = spots[scope];
  useEffect(() => {
    if (!spot) return;
    const instant = reduced || !placed.current;
    placed.current = true;
    left.value = instant ? spot.x : withTiming(spot.x, { duration: t.durations.slow, easing: EASE });
    width.value = instant ? spot.w : withTiming(spot.w, { duration: t.durations.slow, easing: EASE });
    if (spot.x != null) scroller.current?.scrollTo({ x: Math.max(0, spot.x - 24), animated: !instant });
  }, [spot?.x, spot?.w, reduced, left, width, t.durations.slow]);

  // `.jelly`: 1 → (1.18, 0.8) → 1 whenever the scope changes.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) return;
    jelly.value = withSequence(
      withTiming(1, { duration: 180, easing: EASE }),
      withTiming(0, { duration: 220, easing: EASE }),
    );
  }, [scope, reduced, jelly]);

  const indicator = useAnimatedStyle(() => ({
    left: left.value,
    width: width.value,
    opacity: width.value > 0 ? 1 : 0,
    transform: [{ scaleX: 1 + 0.18 * jelly.value }, { scaleY: 1 - 0.2 * jelly.value }],
  }));

  const unpin = useCallback(
    (library: Library) => {
      void update({ library: { pinned: pinned.filter((id) => id !== library.id) } });
      setSpots((current) => {
        const { [libraryScope(library.id)]: _dropped, ...rest } = current;
        return rest;
      });
      if (scope === libraryScope(library.id)) onScope("home");
    },
    [pinned, update, scope, onScope],
  );

  const pin = useCallback(
    (library: Library) => {
      if (!pinned.includes(library.id)) void update({ library: { pinned: [...pinned, library.id] } });
      setAdd(false);
      onScope(libraryScope(library.id));
    },
    [pinned, update, onScope],
  );

  const hold = useCallback((library: Library) => {
    haptic("medium");
    setMenu(library);
    setMenuOpen(true);
  }, []);

  return (
    <>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        style={s.scroller}
        contentContainerStyle={[s.row, { paddingHorizontal: pagePad }]}
      >
        {tabs.map((tab) => {
          const active = tab.key === scope;
          return (
            <PressableScale
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              scaleTo={0.94}
              onPress={() => onScope(tab.key)}
              onLongPress={tab.library ? () => hold(tab.library as Library) : undefined}
              delayLongPress={LONG_PRESS_MS}
              onLayout={measure(tab.key)}
              style={s.chip}
            >
              <Text numberOfLines={1} style={[active ? s.labelOn : s.label, tab.library ? s.libLabel : null]}>
                {tab.label}
              </Text>
            </PressableScale>
          );
        })}
        <IconButton icon={Plus} label={tr("addLibrary")} size={18} hit={CHIP_H} onPress={() => setAdd(true)} />
        <Animated.View pointerEvents="none" style={[s.indicator, indicator]} />
      </ScrollView>

      <AddLibrarySheet visible={add} onClose={() => setAdd(false)} available={libraries} pinned={pinned} onPick={pin} />
      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={menu?.name}
        actions={
          menu
            ? [{ key: "unpin", label: tr("removeLibrary"), icon: X, destructive: true, onPress: () => unpin(menu) }]
            : []
        }
      />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  scroller: { height: SCOPE_ROW_HEIGHT, flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 18, position: "relative" },
  chip: { height: CHIP_H, justifyContent: "center" },
  label: { ...text(15, "medium"), color: t.white(0.7) },
  labelOn: { ...text(15, "semibold"), color: t.colors.text },
  libLabel: { maxWidth: 160 },
  indicator: { position: "absolute", bottom: 0, height: 3, borderRadius: 2, backgroundColor: t.colors.accent },
}));
