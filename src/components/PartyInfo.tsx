import { useEffect, useRef, useState } from "react";
import { Check, Copy, Crown, LoaderCircle, Lock, LogOut, WifiOff } from "lucide-react";
import { partyApi, type PartyStatus } from "../lib/party";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { Avatar } from "./Avatar";
import { Toggle } from "./settings/Toggle";

/** The code with a copy button, big enough to read out over a call. */
export function PartyCode({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the code stays on screen */
    }
  };

  return (
    <div className="rounded-xl bg-white/6 p-3">
      <p className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{t("partyCode")}</p>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[20px] font-semibold tracking-[0.06em] text-text select-all tabular">
          {code}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="btn-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[13px] font-medium text-text hover:bg-white/16"
        >
          {copied ? <Check size={15} className="text-accent" /> : <Copy size={15} />}
          {copied ? t("partyCopied") : t("partyCopy")}
        </button>
      </div>
    </div>
  );
}

/** Connection state in one line (connecting, reconnecting, host away...). */
export function PartyPhase({ status }: { status: PartyStatus }) {
  const { t } = useI18n();
  const waiting = status.phase === "connecting" || status.phase === "reconnecting";
  const text = status.hostAway
    ? t("partyHostAway")
    : status.phase === "connecting"
      ? t("partyConnecting")
      : status.phase === "reconnecting"
        ? t("partyReconnecting")
        : t("partyLive");
  return (
    <p className={cn("flex items-center gap-2 text-[12px]", waiting || status.hostAway ? "text-warning" : "text-dim")} role="status">
      {waiting ? (
        <LoaderCircle size={13} className="animate-spin" />
      ) : status.hostAway ? (
        <WifiOff size={13} />
      ) : (
        <span className="h-2 w-2 rounded-full bg-success" />
      )}
      <span className="min-w-0 truncate">{text}</span>
      {status.private && !waiting ? (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-dim" title={t("partyPrivate")}>
          <Lock size={12} />
        </span>
      ) : null}
    </p>
  );
}

/**
 * Everything about the party but the chat: code, connection, the host's permission
 * switch, who is in, and the way out (leaving, or ending it for all as the host).
 */
export function PartyInfo({ status, onLeft }: { status: PartyStatus; onLeft?: () => void }) {
  const { t } = useI18n();

  const leave = () => {
    void partyApi.leave().catch(() => undefined);
    onLeft?.();
  };

  return (
    <div className="space-y-4">
      <PartyCode code={status.code} />
      <PartyPhase status={status} />
      {status.host ? (
        <label className="flex items-center gap-3 text-[13px] text-text">
          <span className="min-w-0 flex-1">{t("partyEveryoneControls")}</span>
          <Toggle
            checked={status.open}
            label={t("partyEveryoneControls")}
            onChange={(open) => void partyApi.setOpen(open).catch(() => undefined)}
          />
        </label>
      ) : null}
      <div>
        <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">
          {t("partyMembers", { n: status.members.length })}
        </p>
        <ul className="space-y-1">
          {status.members.map((member) => (
            <li key={member.id} className="flex min-h-10 items-center gap-3 rounded-lg px-1">
              <Avatar src={member.avatar} name={member.name} size={28} />
              <span className="min-w-0 flex-1 truncate text-[14px]">
                {member.name}
                {member.id === status.selfId ? <span className="text-dim"> ({t("partyYou")})</span> : null}
              </span>
              {member.host ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                  <Crown size={11} />
                  {t("partyHostBadge")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={leave}
        className={cn(
          "btn-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-btn text-[14px] font-semibold",
          status.host ? "bg-danger text-white hover:bg-[color-mix(in_oklab,var(--color-danger)_88%,white)]" : "bg-white/10 text-text hover:bg-white/16",
        )}
      >
        <LogOut size={16} />
        {status.host ? t("partyEnd") : t("partyLeave")}
      </button>
    </div>
  );
}
