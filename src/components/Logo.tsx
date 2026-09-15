import wordmark from "../assets/ejflix-wordmark.png";
import { cn } from "../lib/format";

/** The ejFlix wordmark. `nav` sits in the header bar, `login` heads the sign-in screens. */
export function Logo({ size = "nav" }: { size?: "nav" | "login" }) {
  return (
    <img
      src={wordmark}
      alt="ejFlix"
      draggable={false}
      className={cn("w-auto select-none object-contain", size === "nav" ? "h-[22px]" : "h-[38px]")}
    />
  );
}
