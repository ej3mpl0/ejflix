import { useEffect, useRef } from "react";

/**
 * Runs `handler` on Escape and on the mouse "back" side button (button 3). Pass `null`
 * to disable while something else owns those inputs (a modal, a page on top).
 * Buttons 3/4 are prevented on mousedown so WebView2 never tries history navigation.
 */
export function useBackNavigation(handler: (() => void) | null): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !ref.current) return;
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === "SELECT") return;
      e.preventDefault();
      ref.current();
    };
    const onDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 3 || !ref.current) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
}
