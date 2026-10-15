import { Mark } from "../Mark";
import { useI18n } from "../../lib/locale-context";
import { cn } from "../../lib/format";

/**
 * Covers for the first-run pictures. They come from Cinemeta's image host (the catalog
 * every profile gets), so a fresh install already shows what a library looks like; offline
 * the tiles simply stay dark.
 */
const COVERS = [
  "tt15239678", "tt4574334", "tt1502407", "tt0816692", "tt11280740", "tt6751668",
  "tt7784604", "tt0903747", "tt1375666", "tt9362722", "tt0468569", "tt14452776",
  "tt5052448", "tt3235888", "tt1856101", "tt13443470", "tt0944947", "tt11126994",
  "tt15398776", "tt6763664", "tt5753856", "tt3581920", "tt1190634", "tt0110912",
];
export const posterOf = (imdb: string) => `https://images.metahub.space/poster/medium/${imdb}/img`;
export const backdropOf = (imdb: string) => `https://images.metahub.space/background/large/${imdb}/img`;

/** A still wall of real covers, tilted, fading into the panel on the left. */
export function PosterWall({ dim = false }: { dim?: boolean }) {
  const tiles = [...COVERS, ...COVERS.slice(0, 12)];
  return (
    <div className="absolute inset-0" aria-hidden>
      <div className="absolute -inset-x-20 -inset-y-28 grid -rotate-[8deg] grid-cols-6 gap-3.5">
        {tiles.map((id, i) => (
          <div
            key={i}
            className={cn("aspect-[2/3] overflow-hidden rounded-lg bg-surface", (i % 6 === 1 || i % 6 === 3) && "-translate-y-[90px]")}
          >
            <img src={posterOf(id)} alt="" loading="lazy" className={cn("h-full w-full object-cover", dim ? "brightness-[0.45]" : "brightness-[0.8]")} />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-base)_0%,rgb(16_13_14_/_0.55)_22%,rgb(16_13_14_/_0.1)_60%),linear-gradient(0deg,rgb(16_13_14_/_0.6),transparent_40%)]" />
    </div>
  );
}

/** The same title on a PC and on a phone, at the same point: what the account carries over. */
export function DevicesVisual() {
  const { t } = useI18n();
  const card = (id: string, height: string, progress: boolean) => (
    <div className={cn("relative overflow-hidden rounded-[9px] bg-panel", height)}>
      <img src={backdropOf(id)} alt="" className="h-full w-full object-cover" />
      {progress ? (
        <span className="absolute inset-x-2 bottom-2 h-[3px] rounded-full bg-white/30">
          <span className="relative block h-full w-[62%] rounded-full bg-live">
            <span className="absolute top-1/2 right-0 h-2 w-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-live" />
          </span>
        </span>
      ) : null}
    </div>
  );
  return (
    <div className="absolute inset-0" aria-hidden>
      <div className="absolute top-[18%] left-[8%] w-[min(470px,70%)] rounded-[18px] border-[10px] border-[#2a2425] bg-surface p-4 shadow-[0_30px_70px_rgb(0_0_0_/_0.5)]">
        <div className="mb-3.5 flex items-center gap-2.5">
          <Mark size={16} />
          <span className="text-[11px] text-muted">Windows</span>
        </div>
        <p className="mb-2 font-display text-[13px] font-semibold">{t("continueWatching")}</p>
        <div className="grid grid-cols-[1.5fr_1fr] gap-2.5">
          {card("tt0944947", "h-[130px]", true)}
          {card("tt11280740", "h-[130px]", false)}
        </div>
      </div>
      <div className="absolute top-[38%] left-[min(470px,62%)] w-[190px] rounded-[30px] border-8 border-[#2a2425] bg-surface p-3.5 shadow-[0_30px_70px_rgb(0_0_0_/_0.6)]">
        <div className="mb-3 flex items-center gap-2">
          <Mark size={14} />
        </div>
        <p className="mb-2 font-display text-[12px] font-semibold">{t("continueWatching")}</p>
        {card("tt0944947", "h-[86px]", true)}
        <div className="mt-2.5">{card("tt11280740", "h-[86px]", false)}</div>
      </div>
      <div className="absolute bottom-[12%] left-[8%] flex w-[min(400px,80%)] flex-wrap gap-2">
        {[t("syncServers"), t("addons"), t("syncIptv"), t("myList"), t("syncProgress"), t("syncProfiles")].map((label) => (
          <span key={label} className="inline-flex h-8 items-center rounded-pill bg-surface px-3.5 text-[13px] font-medium">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A film still with a subtitle, in the language picked on the left. */
export function SubtitleVisual({ language }: { language: string }) {
  const { t } = useI18n();
  const samples: Record<string, string> = {
    spa: "—No vinimos a gobernar.\nVinimos a sobrevivir.",
    eng: "—We did not come to rule.\nWe came to survive.",
    cat: "—No vam venir a governar.\nVam venir a sobreviure.",
    fra: "—Nous ne sommes pas venus régner.\nNous sommes venus survivre.",
    ita: "—Non siamo venuti a governare.\nSiamo venuti a sopravvivere.",
    por: "—Não viemos para governar.\nViemos para sobreviver.",
    deu: "—Wir kamen nicht, um zu herrschen.\nWir kamen, um zu überleben.",
  };
  const text = language === "off" ? null : samples[language] ?? samples.spa;
  return (
    <div className="absolute inset-0" aria-hidden>
      <img src={backdropOf("tt15239678")} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_40%]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-base),transparent_25%),linear-gradient(0deg,rgb(0_0_0_/_0.55),transparent_40%)]" />
      {text ? (
        <p className="absolute inset-x-0 bottom-[11%] text-center text-[28px] leading-[1.35] font-semibold whitespace-pre-line [text-shadow:0_2px_6px_rgb(0_0_0_/_0.9),0_0_2px_#000]">
          {text}
        </p>
      ) : (
        <p className="absolute inset-x-0 bottom-[11%] text-center text-[15px] text-white/70">{t("subtitlesOffSample")}</p>
      )}
    </div>
  );
}

/** The sources of one film, with the ones torrents add marked: what the switch changes. */
export function TorrentsVisual({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const rows: [string, string, boolean][] = [
    ["4K", "Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR10+", false],
    ["4K", "Dune Part Two 2024 UHD BluRay REMUX", true],
    ["4K", "Dune.Parte.Dos.2024.2160p.Castellano", true],
    ["1080p", "Dune.Part.Two.2024.1080p.BluRay.DUAL-ESP", false],
    ["1080p", "Dune Parte Dos 2024 1080p Castellano AC3", true],
    ["1080p", "Dune.Part.Two.2024.1080p.WEBRip.x265", true],
    ["720p", "Dune.Part.Two.2024.720p.WEB.h264", false],
  ];
  const shown = enabled ? rows : rows.filter((row) => !row[2]);
  return (
    <div className="absolute inset-0 grid place-items-center p-12" aria-hidden>
      <div className="w-full max-w-[520px] rounded-[18px] bg-surface p-6 shadow-[0_30px_70px_rgb(0_0_0_/_0.5)]">
        <p className="font-display text-[20px] font-bold">Dune: Parte dos</p>
        <p className="mb-4 text-[13.5px] text-muted">{t("sourceCount", { count: String(shown.length) })}</p>
        <div className="space-y-2">
          {shown.map(([quality, name, torrent]) => (
            <div
              key={name}
              className={cn(
                "flex items-center gap-3 rounded-xl bg-panel px-3.5 py-3",
                torrent && "shadow-[inset_0_0_0_1.5px_rgb(246_243_242_/_0.35)]",
              )}
            >
              <span className="w-14 font-display text-[17px] font-bold">{quality}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{name}</span>
              <span className={cn("rounded-md px-2 py-0.5 text-[11.5px] font-bold", torrent ? "bg-white/14" : "bg-line")}>
                {torrent ? t("torrentBadge") : t("directBadge")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** What the server answered: its name and version, or where to look for the address. */
export function ServerVisual({ found, users }: { found: { name: string; version: string } | null; users: number }) {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0" aria-hidden={!found}>
      <PosterWall dim />
      <div className="absolute inset-0 grid place-items-center p-12">
        {found ? (
          <div className="modal-enter w-full max-w-[420px] rounded-[18px] bg-surface/95 p-7 shadow-[0_30px_70px_rgb(0_0_0_/_0.5)] backdrop-blur-md">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-text">
              <span className="h-[7px] w-[7px] rounded-full bg-live shadow-[0_0_0_4px_var(--color-live-soft)]" />
              {t("serverOnline")}
            </p>
            <p className="mt-3 font-display text-[30px] leading-tight font-bold">{found.name}</p>
            <p className="mt-1 text-[14px] text-muted">Jellyfin {found.version}</p>
            {users ? <p className="mt-4 text-[14px] text-muted">{t("serverUsersCount", { n: users })}</p> : null}
          </div>
        ) : (
          <div className="w-full max-w-[440px] rounded-[18px] bg-surface/95 p-7 shadow-[0_30px_70px_rgb(0_0_0_/_0.5)] backdrop-blur-md">
            <p className="mb-4 font-display text-[19px] font-semibold">{t("serverHelpTitle")}</p>
            <ul className="space-y-3 text-[14px] leading-[1.5] text-muted">
              <li>{t("serverHelpSamePc")}</li>
              <li>{t("serverHelpLan")}</li>
              <li>{t("serverHelpRemote")}</li>
              <li>{t("serverHelpDashboard")}</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Home as it fills up: each new addon brings a row, marked New. */
export function HomeRowsVisual({ rows }: { rows: { title: string; fresh: boolean; covers: string[] }[] }) {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0 overflow-hidden pt-24 pl-14" aria-hidden>
      {rows.map((row, i) => (
        <div key={`${row.title}:${i}`} className={cn("mb-8 transition-opacity duration-300", !row.fresh && "opacity-40")}>
          <p className="mb-3 flex items-center gap-2.5 font-display text-[17px] font-semibold">
            {row.title}
            {row.fresh ? (
              <span className="rounded-full bg-accent px-2 py-0.5 font-sans text-[12px] font-semibold text-on-accent">{t("newBadge")}</span>
            ) : null}
          </p>
          <div className="flex gap-3">
            {row.covers.map((id) => (
              <div key={id} className="h-[198px] w-[132px] shrink-0 overflow-hidden rounded-lg bg-surface">
                <img src={posterOf(id)} alt="" loading="lazy" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
