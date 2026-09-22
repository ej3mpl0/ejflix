import { useEffect, useState } from "react";
import { LoaderCircle, Plus, Puzzle, Settings2, Trash2 } from "lucide-react";
import type { AddonInfo, TorrentCacheInfo } from "../../lib/types";
import { api } from "../../lib/api";
import { formatSize } from "../../lib/addons";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { Select } from "../Select";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { Toggle } from "./Toggle";
import { ConfirmButton } from "../ConfirmButton";
import { fieldClass } from "../../lib/ui";
import { cn } from "../../lib/format";
import { AddonImport } from "../AddonImport";

/** Disk the torrent cache may take, in GB. */
const CACHE_SIZES = [2, 5, 10, 20, 50, 100];
/** Bandwidth caps offered, in KB/s; 0 is no cap. */
const RATE_CAPS = [0, 256, 512, 1024, 2048, 5120, 10240];

function rateLabel(kbps: number, none: string): string {
  if (!kbps) return none;
  return kbps >= 1024 ? `${kbps / 1024} MB/s` : `${kbps} KB/s`;
}

/** Settings › Addons: Stremio addon manifests (catalogs + online sources). */
export function AddonsSection({
  onToast,
  part = "addons",
}: {
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
  /** Settings shows the addons and the torrent engine as two sections. */
  part?: "addons" | "torrents";
}) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [addons, setAddons] = useState<AddonInfo[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [cache, setCache] = useState<TorrentCacheInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .torrentCacheInfo()
      .then((info) => {
        if (alive) setCache(info);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const clearCache = async () => {
    try {
      setCache(await api.torrentCacheClear());
      onToast(t("torrentsCacheCleared"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  const cacheUsage = cache
    ? cache.torrents
      ? t("torrentsCacheUsage", { size: formatSize(cache.bytes) || "0 MB", count: String(cache.torrents) })
      : t("torrentsCacheEmpty")
    : "";
  const key = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}|${settings.addons.disabled.join("|")}`;

  /** Switches one addon off (kept in the list) or back on. */
  const setEnabled = (addon: AddonInfo, enabled: boolean) => {
    const current = settings.addons.disabled;
    const disabled = enabled ? current.filter((u) => u !== addon.url) : [...current.filter((u) => u !== addon.url), addon.url];
    void update({ addons: { disabled } });
  };

  useEffect(() => {
    let alive = true;
    api
      .addonsAll()
      .then((list) => {
        if (alive) setAddons(list);
      })
      .catch(() => {
        if (alive) setAddons([]);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  const add = async () => {
    const value = url.trim();
    if (!value) return;
    setBusy(true);
    try {
      const info = await api.addonAdd(value);
      setUrl("");
      onToast(t("addonAdded", { name: info.name }));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Removes at once and offers Undo, which adds it back in the same on/off state. */
  const remove = async (addon: AddonInfo) => {
    const wasOff = settings.addons.disabled.includes(addon.url);
    try {
      await api.addonRemove(addon.url);
      onToast(t("addonRemoved", { name: addon.name }), {
        label: t("undo"),
        run: () => {
          void api
            .addonAdd(addon.url)
            .then(() => {
              if (wasOff) void update({ addons: { disabled: [...settings.addons.disabled.filter((u) => u !== addon.url), addon.url] } });
            })
            .catch((err) => onToast(err instanceof Error ? err.message : String(err)));
        },
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  return part === "addons" ? (
    <>
      <SettingsSection title={t("addons")} description={t("addonsHint")}>
        <form
          className="flex gap-2 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("addonUrlPlaceholder")}
            aria-label={t("addAddon")}
            className={cn(fieldClass, "min-w-0 flex-1")}
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-accent px-4 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}
            {t("addAddon")}
          </button>
        </form>
        {addons == null ? (
          <p className="py-4 text-[13px] text-dim">{t("loading")}…</p>
        ) : addons.length ? (
          addons.map((addon) => (
            <div key={addon.url} className={`flex items-center gap-4 py-3 ${addon.enabled ? "" : "opacity-60"}`}>
              <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/6 text-muted">
                {addon.logo ? <img src={addon.logo} alt="" className="h-full w-full object-cover" /> : <Puzzle size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[14px] font-medium text-text">
                  <span className="truncate">{addon.name}</span>
                  {addon.version ? <span className="text-[11px] text-dim tabular">v{addon.version}</span> : null}
                  {addon.builtin ? (
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
                      {t("builtinAddon")}
                    </span>
                  ) : null}
                  {!addon.enabled ? (
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
                      {t("addonOff")}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[12px] text-dim">
                  {addon.description || addon.url}
                  {addon.catalogs.length ? ` · ${addon.catalogs.length} ${t("catalogs")}` : ""}
                  {addon.resources.includes("stream") ? ` · ${t("streams")}` : ""}
                </p>
              </div>
              {!addon.builtin ? (
                <Toggle checked={addon.enabled} onChange={(on) => setEnabled(addon, on)} label={addon.name} />
              ) : null}
              {addon.configureUrl ? (
                <button
                  type="button"
                  onClick={() => void api.openExternal(addon.configureUrl ?? "").catch(() => undefined)}
                  aria-label={t("configureAddon")}
                  title={t("configureAddon")}
                  className="icon-hit grid h-9 w-9 shrink-0 place-items-center rounded-full text-dim hover:bg-white/8 hover:text-text"
                >
                  <Settings2 size={16} />
                </button>
              ) : null}
              {/* Built-ins (Cinemeta) are switched in their own section, never removed. */}
              {!addon.builtin ? (
                <button
                  type="button"
                  onClick={() => void remove(addon)}
                  aria-label={`${t("removeAddon")}: ${addon.name}`}
                  title={t("removeAddon")}
                  className="icon-hit grid h-9 w-9 shrink-0 place-items-center rounded-full text-dim hover:bg-white/8 hover:text-text"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <p className="py-4 text-[13px] text-dim">{t("noAddons")}</p>
        )}
      </SettingsSection>
      <SettingsSection title={t("importAddons")} description={t("importAddonsHint")}>
        <div className="max-w-[520px] py-4">
          <AddonImport />
        </div>
      </SettingsSection>
      <SettingsSection title="Cinemeta">
        <SettingsRow label={t("cinemetaRow")} hint={t("cinemetaHint")}>
          <Toggle
            checked={settings.addons.cinemeta}
            onChange={(cinemeta) => void update({ addons: { cinemeta } })}
            label={t("cinemetaRow")}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  ) : (
    <>
      <SettingsSection title={t("torrentsTitle")} description={t("torrentsDescription")}>
        <SettingsRow label={t("torrentsEnabled")} hint={t("torrentsEnabledHint")}>
          <Toggle
            checked={settings.torrents.enabled}
            onChange={(enabled) => {
              void update({ torrents: { enabled } });
              if (!enabled) void api.torrentPauseAll().catch(() => undefined);
            }}
            label={t("torrentsEnabled")}
          />
        </SettingsRow>
        <SettingsRow label={t("torrentsShare")} hint={t("torrentsShareHint")}>
          <Toggle
            checked={settings.torrents.share}
            onChange={(share) => void update({ torrents: { share } })}
            label={t("torrentsShare")}
          />
        </SettingsRow>
        <SettingsRow label={t("torrentsUpload")} hint={t("torrentsUploadHint")}>
          <Select
            label={t("torrentsUpload")}
            value={String(settings.torrents.uploadKbps)}
            onChange={(value) => void update({ torrents: { uploadKbps: Number(value) } })}
            className="h-11 min-w-[130px]"
            options={RATE_CAPS.map((kb) => ({ value: String(kb), label: rateLabel(kb, t("torrentsNoLimit")) }))}
          />
        </SettingsRow>
        <SettingsRow label={t("torrentsDownload")} hint={t("torrentsDownloadHint")}>
          <Select
            label={t("torrentsDownload")}
            value={String(settings.torrents.downloadKbps)}
            onChange={(value) => void update({ torrents: { downloadKbps: Number(value) } })}
            className="h-11 min-w-[130px]"
            options={RATE_CAPS.map((kb) => ({ value: String(kb), label: rateLabel(kb, t("torrentsNoLimit")) }))}
          />
        </SettingsRow>
        <SettingsRow label={t("torrentsCache")} hint={[t("torrentsCacheHint"), cacheUsage].filter(Boolean).join(" ")}>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label={t("torrentsCache")}
              value={String(settings.torrents.cacheGb)}
              onChange={(value) => void update({ torrents: { cacheGb: Number(value) } })}
              className="h-11 min-w-[110px]"
              options={CACHE_SIZES.map((gb) => ({ value: String(gb), label: `${gb} GB` }))}
            />
            <ConfirmButton
              confirmLabel={t("torrentsClearCache")}
              onConfirm={() => clearCache()}
              trigger={(ask) => (
                <button
                  type="button"
                  disabled={!cache?.torrents}
                  onClick={ask}
                  className="btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-4 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60"
                >
                  <Trash2 size={16} />
                  {t("torrentsClearCache")}
                </button>
              )}
            />
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
