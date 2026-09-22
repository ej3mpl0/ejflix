import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { useI18n } from "../lib/locale-context";
import { Pill } from "./Pill";

/**
 * "Load more" under a grid. It also loads by itself once it scrolls into view (infinite
 * scroll); the button stays for keyboard users and as a fallback.
 */
export function LoadMoreButton({
  loading,
  onLoad,
  remaining,
}: {
  loading: boolean;
  onLoad: () => void;
  /** How many are left, when known. */
  remaining?: number;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !loadingRef.current) onLoadRef.current();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="mt-10 flex justify-center">
      <Pill
        pill
        disabled={loading}
        onClick={onLoad}
        icon={loading ? <LoaderCircle size={16} className="animate-spin" /> : null}
        className="px-6"
      >
        {t("loadMore")}
        {remaining != null ? ` (${remaining})` : ""}
      </Pill>
    </div>
  );
}
