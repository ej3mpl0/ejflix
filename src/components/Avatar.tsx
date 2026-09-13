import { useState } from "react";

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

  return (
    <span
      className="img-outline relative grid place-items-center overflow-hidden rounded-full bg-accent text-[12px] font-semibold text-on-accent"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
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
