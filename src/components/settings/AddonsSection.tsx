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

/** Disk the torrent cache may take, in GB. */
const CACHE_SIZES = [2, 5, 10, 20, 50, 100];

/** Settings › Addons: Stremio addon manifests (catalogs + online sources). */
export function AddonsSection({ onToast }: { onToast: (message: string) => void }) {
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
  const key = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;

  useEffect(() => {
    let alive = true;
    api
      .addonsList()
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

  const remove = async (addon: AddonInfo) => {
    try {
      await api.addonRemove(addon.url);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
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
            className="h-11 min-w-0 flex-1 rounded-btn border border-white/12 bg-black/40 px-3 text-sm text-text outline-none placeholder:text-dim focus:border-accent"
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
            <div key={addon.url} className="flex items-center gap-4 py-3">
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
                </p>
                <p className="truncate text-[12px] text-dim">
                  {addon.description || addon.url}
                  {addon.catalogs.length ? ` · ${addon.catalogs.length} ${t("catalogs")}` : ""}
                  {addon.resources.includes("stream") ? ` · ${t("streams")}` : ""}
                </p>
              </div>
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
              <button
                type="button"
                onClick={() => void remove(addon)}
                aria-label={t("removeAddon")}
                title={t("removeAddon")}
                className="icon-hit grid h-9 w-9 shrink-0 place-items-center rounded-full text-dim hover:bg-white/8 hover:text-text"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        ) : (
          <p className="py-4 text-[13px] text-dim">{t("noAddons")}</p>
        )}
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
      <SettingsSection title={t("torrentsTitle")} description={t("torrentsDescription")}>
        <SettingsRow label={t("torrentsEnabled")} hint={t("torrentsEnabledHint")}>
          <Toggle
            checked={settings.torrents.enabled}
            onChange={(enabled) => void update({ torrents: { enabled } })}
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
        <SettingsRow label={t("torrentsCache")} hint={[t("torrentsCacheHint"), cacheUsage].filter(Boolean).join(" ")}>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label={t("torrentsCache")}
              value={String(settings.torrents.cacheGb)}
              onChange={(value) => void update({ torrents: { cacheGb: Number(value) } })}
              className="h-11 min-w-[110px]"
              options={CACHE_SIZES.map((gb) => ({ value: String(gb), label: `${gb} GB` }))}
            />
            <button
              type="button"
              disabled={!cache?.torrents}
              onClick={() => void clearCache()}
              className="btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-4 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60"
            >
              <Trash2 size={16} />
              {t("torrentsClearCache")}
            </button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
