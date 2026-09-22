import { useCallback, useEffect, useRef } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

/**
 * Android back button while the screen is focused. `handler` returns true when it
 * consumed the press (closed a sheet, left edit mode…); false lets navigation pop.
 */
export function useBackHandler(enabled: boolean, handler: () => boolean | void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => handlerRef.current() === true);
      return () => sub.remove();
    }, [enabled]),
  );
}

/** Same, outside a navigator (modals, the boot screen). */
export function useGlobalBackHandler(enabled: boolean, handler: () => boolean | void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => handlerRef.current() === true);
    return () => sub.remove();
  }, [enabled]);
}
