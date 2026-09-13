import { cn } from "../lib/format";

export function Logo({ size = "nav" }: { size?: "nav" | "login" }) {
  return (
    <span
      className={cn(
        "font-brand tracking-[0.04em] bg-clip-text text-transparent",
        size === "nav" ? "text-[24px] leading-none" : "text-[40px] leading-none",
      )}
      style={{ backgroundImage: "var(--brand-gradient)" }}
    >
      EJFLIX
    </span>
  );
}
