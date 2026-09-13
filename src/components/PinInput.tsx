import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/format";

/** Four-digit PIN entry: one hidden input, four boxes; submits by itself on the 4th digit. */
export function PinInput({
  onSubmit,
  error = false,
  disabled = false,
}: {
  onSubmit: (pin: string) => void;
  error?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (error) setValue("");
  }, [error]);

  const update = (next: string) => {
    const digits = next.replace(/\D/g, "").slice(0, 4);
    setValue(digits);
    if (digits.length === 4) onSubmit(digits);
  };

  return (
    <div className="relative" onClick={() => input.current?.focus()}>
      <input
        ref={input}
        value={value}
        onChange={(e) => update(e.target.value)}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        type="password"
        disabled={disabled}
        aria-label="PIN"
        className="absolute inset-0 opacity-0"
      />
      <div className={cn("flex gap-3", error && "pin-shake")} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "grid h-16 w-14 place-items-center rounded-2xl border bg-black/40 text-[26px] font-semibold transition-colors duration-150",
              i === value.length ? "border-accent" : "border-white/12",
              error && "border-accent",
            )}
          >
            {value[i] ? "•" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
