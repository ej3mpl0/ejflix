import type { ReactNode } from "react";
import { cn } from "../lib/format";
import { Pill } from "./Pill";

/**
 * The card every screen shows when it has nothing to list (or could not load): an optional
 * icon tile, a title, a hint and one action. `large` is for whole-screen states; `children`
 * go under the action (suggestions).
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  large = false,
  className,
  children,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: { label: string; onClick: () => void; icon?: ReactNode };
  large?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("rounded-card bg-surface px-8 py-12 text-center", large && "mx-auto max-w-[560px]", className)}>
      {icon ? (
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</span>
      ) : null}
      <p className={cn(large ? "text-[18px] font-semibold" : "text-[16px] font-medium", "[text-wrap:balance]")}>{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-[52ch] text-[13px] text-dim [overflow-wrap:anywhere]">{hint}</p> : null}
      {action ? (
        <Pill variant="primary" className="mt-6" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Pill>
      ) : null}
      {children}
    </div>
  );
}
