import { useState } from "react";
import { PartyPopper } from "lucide-react";
import { partyApi, startParty, type PartyStatus } from "../lib/party";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { Pill } from "./Pill";

/** Header button: opens the party dialog; while in one, shows how many are in. */
export function PartyButton({ status, onClick }: { status: PartyStatus | null; onClick: () => void }) {
  const { t } = useI18n();
  const active = status?.active === true;
  const count = active ? status.members.length : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? `${t("partyTitle")} · ${t("partyMembers", { n: count })}` : t("partyJoinTitle")}
      title={active ? t("partyTitle") : t("partyJoinTitle")}
      className={cn(
        "relative grid h-9 w-9 place-items-center rounded-full transition-colors duration-150 hover:bg-white/10",
        active ? "text-accent" : "text-text/80 hover:text-text",
      )}
    >
      <PartyPopper size={18} />
      {active && count > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent tabular">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * "Watch together" on a details page: starts a party (unless already hosting one) and
 * plays the title as the Play button would; the player then shows the code to share.
 */
export function WatchTogetherButton({ onPlay, disabled }: { onPlay: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const current = await partyApi.status().catch(() => null);
      if (!current?.active || !current.host) await startParty();
      onPlay();
    } catch {
      /* the party could not start: the Play button is still there */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pill variant="tonal" pill size="lg" icon={<PartyPopper size={17} />} disabled={disabled || busy} onClick={() => void run()}>
      {t("partyWatchTogether")}
    </Pill>
  );
}
