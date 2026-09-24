import { useEffect, useRef, useState } from "react";
import { PartyPopper, SendHorizontal, X } from "lucide-react";
import { CHAT_MAX, PARTY_REACTIONS, partyErrorKey, partyErrorOf, startParty, type PartyStatus } from "../lib/party";
import { sendChat, sendReaction, setChatReading, usePartyChat } from "../lib/party-chat";
import { partySelfName } from "../hooks/useParty";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { PartyInfo } from "./PartyInfo";
import { Pill } from "./Pill";

/** The six reactions, as a row of buttons. */
export function ReactionBar({ name, onError }: { name: string; onError: (message: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-1" role="group" aria-label={t("partyReact")}>
      {PARTY_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => void sendReaction(emoji, name).catch((err) => onError(t(partyErrorKey(partyErrorOf(err)))))}
          className="btn-press grid h-10 w-10 place-items-center rounded-full text-[20px] hover:bg-white/10"
          aria-label={`${t("partyReact")} ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/**
 * Side panel inside the player: the party (code, people, permission), reactions and a
 * small chat. Without a party, a way to start one on what is playing.
 */
export function PartyPanel({
  status,
  onClose,
  onHoldUi,
  onNotice,
}: {
  status: PartyStatus | null;
  onClose: () => void;
  onHoldUi: (hold: boolean) => void;
  /** Short message on the video (a send refused by the rate limit...). */
  onNotice: (message: string) => void;
}) {
  const { t } = useI18n();
  const { lines } = usePartyChat();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const live = status?.active ? status : null;
  const name = partySelfName(status);

  useEffect(() => {
    setChatReading(true);
    return () => setChatReading(false);
  }, []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [lines.length]);

  const send = async () => {
    if (!text.trim()) return;
    try {
      await sendChat(text, name);
      setText("");
    } catch (err) {
      onNotice(t(partyErrorKey(partyErrorOf(err))));
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      await startParty();
    } catch (err) {
      onNotice(t(partyErrorKey(partyErrorOf(err))));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      data-own-wheel
      className="panel-in absolute inset-y-0 right-0 z-[35] flex w-[380px] max-w-full flex-col border-l border-white/10 bg-surface/95 text-text shadow-[-24px_0_48px_rgb(0_0_0_/_0.45)] backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseEnter={() => onHoldUi(true)}
      onMouseLeave={() => onHoldUi(false)}
    >
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <PartyPopper size={18} className="shrink-0 text-accent" />
        <p className="min-w-0 flex-1 truncate text-[16px] font-semibold">{t("partyTitle")}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="icon-hit grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"
        >
          <X size={18} />
        </button>
      </div>
      {live ? (
        <>
          <div className="max-h-[48%] shrink-0 overflow-y-auto px-5 pb-4">
            <PartyInfo status={live} />
          </div>
          <div className="border-t border-white/8 px-4 pt-2">
            <ReactionBar name={name} onError={onNotice} />
          </div>
          <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-3" aria-live="polite">
            {lines.length ? (
              lines.map((line) => (
                <div key={line.id} className={cn("flex flex-col", line.mine ? "items-end" : "items-start")}>
                  {!line.mine ? <span className="mb-0.5 px-1 text-[11px] text-dim">{line.name}</span> : null}
                  <p
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug break-words",
                      line.mine ? "bg-accent text-on-accent" : "bg-white/10 text-text",
                    )}
                  >
                    {line.text}
                  </p>
                </div>
              ))
            ) : (
              <p className="pt-2 text-center text-[12px] text-dim">{t("partyChatEmpty")}</p>
            )}
          </div>
          <form
            className="flex gap-2 border-t border-white/8 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={text}
              maxLength={CHAT_MAX}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("partyChatPlaceholder")}
              aria-label={t("partyChat")}
              className="field-own-focus h-10 min-w-0 flex-1 rounded-full border border-white/12 bg-black/40 px-4 text-[13px] text-text outline-none placeholder:text-dim focus:border-accent"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label={t("partySend")}
              className="btn-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              <SendHorizontal size={17} />
            </button>
          </form>
        </>
      ) : (
        <div className="space-y-4 px-5 pb-5">
          <p className="text-[13px] text-muted">{t("partyStartHint")}</p>
          {status?.phase === "ended" && status.error ? (
            <p className="rounded-xl bg-danger/12 px-3 py-2.5 text-[13px] text-danger" role="alert">
              {t(partyErrorKey(status.error))}
            </p>
          ) : null}
          <Pill variant="primary" className="w-full" icon={<PartyPopper size={16} />} disabled={busy} onClick={() => void start()}>
            {t("partyStart")}
          </Pill>
        </div>
      )}
    </aside>
  );
}
