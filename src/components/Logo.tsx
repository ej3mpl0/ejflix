import { cn } from "../lib/format";

export function Logo({ size = "nav" }: { size?: "nav" | "login" }) {
  return (
    <span
      className={cn(
        "font-brand tracking-[0.04em] bg-gradient-to-b from-[#F6121D] to-[#B00710] bg-clip-text text-transparent",
        size === "nav" ? "text-[24px] leading-none" : "text-[40px] leading-none",
      )}
    >
      EJFLIX
    </span>
  );
}
