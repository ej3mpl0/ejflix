import { useState } from "react";
import { presetGradient } from "../lib/avatars";

/** Round avatar: a picture, a preset gradient (`preset:n`) or the initial on the accent. */
export function Avatar({
  src,
  name,
  size = 32,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name[0] || "E").toUpperCase();
  const preset = src ? presetGradient(src) : null;

  return (
    <span
      className="img-outline relative grid place-items-center overflow-hidden rounded-full bg-accent font-semibold text-on-accent"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.round(size * 0.4)),
        ...(preset ? { backgroundImage: preset, color: "#fff" } : {}),
      }}
    >
      {src && !preset && !failed ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
