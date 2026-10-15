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
    // Flat: a heading and rows split by hairlines, no card around every group.
    <section>
      <h3 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h3>
      {description ? <p className="mt-1 max-w-[64ch] text-[13.5px] text-muted">{description}</p> : null}
      <div className="mt-2 divide-y divide-line">{children}</div>
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
    // A wide control drops under its label instead of squeezing it on a narrow window.
    <div className={stacked ? "py-4" : "flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4"}>
      <div className="min-w-[min(220px,100%)] flex-1">
        <p className="text-[15px] font-semibold text-text">{label}</p>
        {hint ? <p className="mt-0.5 max-w-[60ch] text-[13px] text-muted">{hint}</p> : null}
      </div>
      <div className={stacked ? "mt-3" : "max-w-full"}>{children}</div>
    </div>
  );
}
