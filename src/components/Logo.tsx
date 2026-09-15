import wordmark from "../assets/ejflix-wordmark.png";
import { cn } from "../lib/format";

/** The ejFlix wordmark. `nav` sits in the header bar, `login` heads the sign-in screens. */
export function Logo({ size = "nav" }: { size?: "nav" | "login" }) {
  return (
    <img
      src={wordmark}
      alt="ejFlix"
      draggable={false}
      // Inline, so a parent that centres its text centres the wordmark too: the
      // preflight would otherwise make it a block stuck to the left edge.
      className={cn("inline-block w-auto select-none object-contain", size === "nav" ? "h-[22px]" : "h-[38px]")}
    />
  );
}
