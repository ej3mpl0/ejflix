import { useEffect, useState } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

/** The system asks for less motion: no autoplaying video, no auto-advancing slides. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia(REDUCED).matches;
}

/** `prefersReducedMotion`, kept up to date when the system setting changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(REDUCED);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** False while the window is minimised or otherwise hidden. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}
