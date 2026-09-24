import { useState } from "react";
import { LogIn, PartyPopper, Play, X } from "lucide-react";
import { joinParty, partyErrorKey, partyErrorOf, partyTitleLabel, startParty, type PartyStatus } from "../lib/party";
import { cn } from "../lib/format";
import { fieldClass } from "../lib/ui";
import { useI18n } from "../lib/locale-context";
import { Dialog } from "./Dialog";
import { PartyInfo } from "./PartyInfo";
import { Pill } from "./Pill";

/**
 * Watch party from the main window: join with a code or start one; once in, the code,
 * who is in and (guests) a way back to the host's title.
 */
export function PartyDialog({
  status,
  onClose,
  onOpenTitle,
}: {
  status: PartyStatus | null;
  onClose: () => void;
  /** Guests: open (again) what the host is playing. */
  onOpenTitle: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = status?.active === true;
  // A party that just failed or ended says why, until the next attempt.
  const shownError = error ?? (!active && status?.phase === "ended" ? status.error : null);

  const join = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await joinParty(code);
    } catch (err) {
      setError(partyErrorOf(err) || "party:generic");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await startParty();
    } catch (err) {
      setError(partyErrorOf(err) || "party:generic");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      labelledBy="party-title"
      onEscape={onClose}
      onBackdrop={onClose}
      z="z-[80]"
      className="flex max-h-[86vh] w-[min(440px,94vw)] flex-col overflow-hidden rounded-card bg-surface shadow-[0_24px_80px_rgb(0_0_0_/_0.55)]"
    >
      <div className="flex items-start gap-3 px-6 pt-6 pb-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
          <PartyPopper size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="party-title" className="text-[18px] font-semibold">
            {t("partyTitle")}
          </h2>
          <p className="text-[13px] text-dim">{active ? (status.host ? t("partyHostHint") : t("partyJoined")) : t("partyStartHint")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10"
        >
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {active ? (
          <div className="space-y-4">
            {!status.host ? (
              status.title && status.title.kind !== "unsupported" ? (
                <Pill variant="primary" className="w-full" icon={<Play size={16} fill="currentColor" />} onClick={onOpenTitle}>
                  <span className="truncate">{t("partyOpenTitle", { title: partyTitleLabel(status.title) })}</span>
                </Pill>
              ) : (
                <p className="rounded-xl bg-white/6 px-3 py-2.5 text-[13px] text-muted">
                  {status.title ? t("partyUnsupported") : t("partyWaitingTitle")}
                </p>
              )
            ) : null}
            <PartyInfo status={status} />
          </div>
        ) : (
          <>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void join();
              }}
            >
              <label htmlFor="party-code" className="block text-[13px] font-medium text-text">
                {t("partyJoinTitle")}
              </label>
              <div className="flex gap-2">
                <input
                  id="party-code"
                  data-autofocus
                  value={code}
                  maxLength={24}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={t("partyCodePlaceholder")}
                  aria-describedby="party-code-hint"
                  className={cn(fieldClass, "min-w-0 flex-1 font-mono tracking-[0.06em]")}
                />
                <button
                  type="submit"
                  disabled={busy || !code.trim()}
                  className="btn-press inline-flex h-11 shrink-0 items-center gap-2 rounded-btn bg-accent px-4 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
                >
                  <LogIn size={16} />
                  {t("partyJoin")}
                </button>
              </div>
              <p id="party-code-hint" className="text-[12px] text-dim">
                {t("partyJoinHint")}
              </p>
            </form>
            {shownError ? (
              <p className="mt-3 rounded-xl bg-danger/12 px-3 py-2.5 text-[13px] text-danger" role="alert">
                {t(partyErrorKey(shownError))}
              </p>
            ) : null}
            <div className="my-5 h-px bg-white/8" />
            <Pill variant="tonal" className="w-full" icon={<PartyPopper size={16} />} disabled={busy} onClick={() => void start()}>
              {t("partyStart")}
            </Pill>
          </>
        )}
      </div>
    </Dialog>
  );
}
