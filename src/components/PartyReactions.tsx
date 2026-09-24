import { useEffect, useState } from "react";
import { usePartyChat, type ChatLine } from "../lib/party-chat";

const BUBBLE_MS = 5000;

/**
 * Over the video: reactions float up the right edge, and while the party panel is
 * closed the latest chat message shows for a few seconds at the bottom left.
 */
export function PartyReactions({ showChat }: { showChat: boolean }) {
  const { reactions, lines } = usePartyChat();
  const [bubble, setBubble] = useState<ChatLine | null>(null);
  const last = lines[lines.length - 1] ?? null;

  useEffect(() => {
    if (!last || last.mine || Date.now() - last.at > BUBBLE_MS) return;
    setBubble(last);
    const handle = window.setTimeout(() => setBubble((current) => (current?.id === last.id ? null : current)), BUBBLE_MS);
    return () => window.clearTimeout(handle);
  }, [last]);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          aria-hidden
          className="party-float absolute bottom-[120px] flex flex-col items-center"
          style={{ right: `${reaction.x}%` }}
        >
          <span className="text-[40px] leading-none drop-shadow-[0_4px_12px_rgb(0_0_0_/_0.5)]">{reaction.emoji}</span>
          <span className="mt-1 max-w-[120px] truncate rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white/90">
            {reaction.name}
          </span>
        </span>
      ))}
      {showChat && bubble ? (
        <div
          key={bubble.id}
          className="modal-enter absolute bottom-[150px] left-6 max-w-[min(420px,60vw)] rounded-2xl bg-black/65 px-3.5 py-2 text-[13px] text-white backdrop-blur-sm"
          role="status"
        >
          <span className="font-semibold">{bubble.name}: </span>
          <span className="break-words">{bubble.text}</span>
        </div>
      ) : null}
    </div>
  );
}
