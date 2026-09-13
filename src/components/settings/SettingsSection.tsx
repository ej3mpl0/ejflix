import type { ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-6 shadow-[0_0_0_1px_rgb(255_255_255_/_0.05)]">
      <h3 className="text-[17px] font-semibold">{title}</h3>
      {description ? <p className="mt-1 text-[13px] text-dim">{description}</p> : null}
      <div className="mt-4 divide-y divide-white/6">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  children,
  stacked = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  /** Put the control under the label (wide controls such as the theme grid). */
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? "py-4" : "flex min-h-14 items-center justify-between gap-6 py-3"}>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-text">{label}</p>
        {hint ? <p className="mt-0.5 text-[12px] text-dim">{hint}</p> : null}
      </div>
      <div className={stacked ? "mt-3" : "shrink-0"}>{children}</div>
    </div>
  );
}
