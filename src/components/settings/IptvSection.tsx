import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  FileText,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Upload,
} from "lucide-react";
import type { IptvSource, IptvSourceKind, XtreamAccount } from "../../lib/types";
import { api } from "../../lib/api";
import { cn } from "../../lib/format";
import { formatAgo } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { Toggle } from "./Toggle";
import { fieldClass as field } from "../../lib/ui";
import { ListRowsSkeleton } from "../Skeletons";
import { useSettingsIntent } from "../../lib/settings-intent";

const tonal =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60";
const primary =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-accent px-5 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60";

type Form = {
  id: string | null;
  name: string;
  kind: IptvSourceKind;
  url: string;
  path: string;
  username: string;
  password: string;
  epgUrl: string;
  output: "ts" | "m3u8";
  userAgent: string;
  includeVod: boolean;
  enabled: boolean;
  /** Content of a playlist picked with the file input (imported on save). */
  fileText: string | null;
  fileName: string;
};

const EMPTY: Form = {
  id: null,
  name: "",
  kind: "m3uUrl",
  url: "",
  path: "",
  username: "",
  password: "",
  epgUrl: "",
  output: "ts",
  userAgent: "",
  includeVod: false,
  enabled: true,
  fileText: null,
  fileName: "",
};

function formOf(source: IptvSource): Form {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.url,
    path: source.imported ? "" : source.path,
    username: source.username,
    password: "",
    epgUrl: source.epgUrl,
    output: source.output === "m3u8" ? "m3u8" : "ts",
    userAgent: source.userAgent,
    includeVod: source.includeVod,
    enabled: source.enabled,
    fileText: null,
    fileName: source.imported ? source.path : "",
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Settings › IPTV: playlists (M3U by URL or file), Xtream Codes accounts, guide and preferences. */
export function IptvSection({ onToast }: { onToast: (message: string, action?: { label: string; run: () => void }) => void }) {
  const { t, locale } = useI18n();
  const { settings, update } = useSettings();
  const prefs = settings.iptv;
  const [sources, setSources] = useState<IptvSource[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [account, setAccount] = useState<XtreamAccount | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // "Add list" from the TV tab or the palette: open the form straight away.
  useSettingsIntent("iptv-add", () => {
    setForm((current) => current ?? { ...EMPTY });
    setError("");
    setAccount(null);
  });

  const load = async () => {
    try {
      setSources((await api.iptvStatus()).sources);
    } catch {
      setSources([]);
    }
  };

  useEffect(() => {
    void load();
    const unlisten = api.onIptvChanged(() => void load());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const pickFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setForm((f) => (f ? { ...f, fileText: text, fileName: file.name, path: "", name: f.name || file.name.replace(/\.[^.]+$/, "") } : f));
    } catch {
      setError(t("iptvFileError"));
    }
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      let id = form.id;
      if (form.kind === "m3uFile" && form.fileText != null) {
        const imported = await api.iptvSourceImport({ id, name: form.name, fileName: form.fileName, text: form.fileText });
        id = imported.id;
      }
      const saved = await api.iptvSourceSave({
        id,
        name: form.name,
        kind: form.kind,
        url: form.url,
        path: form.kind === "m3uFile" ? form.path : "",
        username: form.username,
        password: form.password || null,
        epgUrl: form.epgUrl,
        output: form.output,
        userAgent: form.userAgent,
        includeVod: form.includeVod,
        enabled: form.enabled,
      });
      setForm(null);
      setAccount(null);
      onToast(t("iptvSaved", { name: saved.name }));
      void load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!form) return;
    setChecking(true);
    setError("");
    setAccount(null);
    try {
      setAccount(await api.iptvXtreamCheck({ url: form.url, username: form.username, password: form.password, userAgent: form.userAgent }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const remove = async (source: IptvSource) => {
    setConfirmId(null);
    try {
      await api.iptvSourceRemove(source.id);
      if (form?.id === source.id) setForm(null);
      void load();
    } catch (err) {
      onToast(errorText(err));
    }
  };

  const refresh = (source: IptvSource) => {
    api.iptvRefresh(source.id).catch((err) => onToast(errorText(err)));
  };

  const kindLabel = (kind: IptvSourceKind) =>
    kind === "xtream" ? t("iptvKindXtream") : kind === "m3uFile" ? t("iptvKindM3uFile") : t("iptvKindM3uUrl");
  const KindIcon = ({ kind }: { kind: IptvSourceKind }) =>
    kind === "xtream" ? <Server size={18} /> : kind === "m3uFile" ? <FileText size={18} /> : <Link2 size={18} />;

  const accountLine = (info: XtreamAccount) => {
    const parts = [
      info.status.toLowerCase() === "active" ? t("iptvAccountActive") : info.status,
      info.expiresMs ? t("iptvAccountExpires", { date: new Date(info.expiresMs).toLocaleDateString(locale === "en" ? "en-GB" : "es-ES") }) : null,
      info.maxConnections != null
        ? t("iptvAccountConnections", { n: info.activeConnections != null ? `${info.activeConnections}/${info.maxConnections}` : String(info.maxConnections) })
        : null,
      info.trial ? t("iptvAccountTrial") : null,
    ];
    return parts.filter(Boolean).join(" · ");
  };

  const statusLine = (source: IptvSource) => {
    if (source.loading) {
      return (
        <span className="flex items-center gap-1.5">
          <LoaderCircle size={12} className="animate-spin" />
          {t("iptvDownloading")}
        </span>
      );
    }
    if (source.error) {
      return (
        <span className="flex items-center gap-1.5 text-danger">
          <AlertCircle size={12} />
          {source.error}
        </span>
      );
    }
    if (!source.channelCount) return t("iptvNotLoaded");
    const parts = [
      t("iptvChannels", { n: source.channelCount }),
      t("iptvGroups", { n: source.groupCount }),
      source.epgChannels ? t("iptvEpgChannels", { n: source.epgChannels }) : source.epgError ? t("iptvEpgError") : t("iptvEpgNone"),
      source.updatedMs ? t("iptvUpdated", { time: formatAgo(source.updatedMs, locale) }) : null,
    ];
    return parts.filter(Boolean).join(" · ");
  };

  const editing = form != null;

  return (
    <>
      <SettingsSection title={t("iptv")} description={t("iptvHint")}>
        {sources == null ? (
          <ListRowsSkeleton />
        ) : sources.length ? (
          sources.map((source) => (
            <div key={source.id} className={cn("flex items-center gap-4 py-3", !source.enabled && "opacity-60")}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <KindIcon kind={source.kind} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[14px] font-medium text-text">
                  <span className="truncate">{source.name}</span>
                  <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
                    {kindLabel(source.kind)}
                  </span>
                  {!source.enabled ? (
                    <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
                      {t("iptvDisabled")}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[12px] text-dim">{statusLine(source)}</p>
                {source.account ? <p className="truncate text-[12px] text-dim">{accountLine(source.account)}</p> : null}
              </div>
              {confirmId === source.id ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => void remove(source)} className="btn-press h-9 rounded-btn bg-danger px-3 text-[13px] font-semibold text-white">
                    {t("delete")}
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="btn-press h-9 rounded-btn bg-white/10 px-3 text-[13px] font-semibold">
                    {t("cancel")}
                  </button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => refresh(source)}
                    disabled={source.loading || !source.enabled}
                    aria-label={t("iptvRefresh")}
                    title={t("iptvRefresh")}
                    className="icon-hit grid h-9 w-9 place-items-center rounded-full text-dim hover:bg-white/8 hover:text-text disabled:opacity-50"
                  >
                    <RefreshCw size={16} className={source.loading ? "animate-spin" : ""} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForm(formOf(source));
                      setError("");
                      setAccount(null);
                    }}
                    aria-label={`${t("iptvEditSource")}: ${source.name}`}
                    title={t("edit")}
                    className="icon-hit grid h-9 w-9 place-items-center rounded-full text-dim hover:bg-white/8 hover:text-text"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(source.id)}
                    aria-label={t("iptvRemove")}
                    title={t("iptvRemove")}
                    className="icon-hit grid h-9 w-9 place-items-center rounded-full text-dim hover:bg-white/8 hover:text-text"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="py-4 text-[13px] text-dim">{t("iptvNoSourcesYet")}</p>
        )}
        {!editing ? (
          <div className="py-4">
            <button
              type="button"
              onClick={() => {
                setForm({ ...EMPTY });
                setError("");
                setAccount(null);
              }}
              className={primary}
            >
              <Plus size={16} />
              {t("iptvAddSource")}
            </button>
          </div>
        ) : null}
      </SettingsSection>

      {form ? (
        <SettingsSection title={form.id ? t("iptvEditSource") : t("iptvAddSource")}>
          <form
            className="space-y-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <SegmentedControl<IptvSourceKind>
              label={t("iptvKind")}
              value={form.kind}
              options={[
                { value: "m3uUrl", label: t("iptvKindM3uUrl") },
                { value: "m3uFile", label: t("iptvKindM3uFile") },
                { value: "xtream", label: t("iptvKindXtream") },
              ]}
              onChange={(kind) => {
                set("kind", kind);
                setAccount(null);
              }}
            />
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">{t("iptvSourceName")}</span>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("iptvSourceNamePlaceholder")} className={field} />
            </label>

            {form.kind === "m3uUrl" ? (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium">{t("iptvUrl")}</span>
                <input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder={t("iptvUrlPlaceholder")} className={field} spellCheck={false} />
              </label>
            ) : null}

            {form.kind === "m3uFile" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/x-mpegurl,application/vnd.apple.mpegurl"
                    className="hidden"
                    onChange={(e) => {
                      void pickFile(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" onClick={() => fileInput.current?.click()} className={tonal}>
                    <Upload size={16} />
                    {t("iptvChooseFile")}
                  </button>
                  {form.fileName ? <span className="text-[13px] text-muted">{t("iptvFileChosen", { name: form.fileName })}</span> : null}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">{t("iptvFilePath")}</span>
                  <input
                    value={form.path}
                    onChange={(e) => set("path", e.target.value)}
                    placeholder={t("iptvPathPlaceholder")}
                    className={field}
                    spellCheck={false}
                  />
                  <span className="mt-1 block text-[12px] text-dim">{t("iptvFilePathHint")}</span>
                </label>
              </div>
            ) : null}

            {form.kind === "xtream" ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">{t("iptvXtreamUrl")}</span>
                  <input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder={t("iptvServerPlaceholder")} className={field} spellCheck={false} />
                  <span className="mt-1 block text-[12px] text-dim">{t("iptvXtreamUrlHint")}</span>
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium">{t("username")}</span>
                    <input value={form.username} onChange={(e) => set("username", e.target.value)} className={field} spellCheck={false} autoComplete="off" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium">{t("password")}</span>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => set("password", e.target.value)}
                      placeholder={form.id ? t("iptvPasswordKeep") : ""}
                      className={field}
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void check()} disabled={checking || !form.url.trim()} className={tonal}>
                    {checking ? <LoaderCircle size={16} className="animate-spin" /> : <Server size={16} />}
                    {checking ? t("iptvChecking") : t("iptvCheck")}
                  </button>
                  {account ? <span className="text-[13px] text-muted">{accountLine(account)}</span> : null}
                </div>
                <SettingsRow label={t("iptvOutput")} hint={t("iptvOutputHint")}>
                  <SegmentedControl<"ts" | "m3u8">
                    label={t("iptvOutput")}
                    value={form.output}
                    options={[
                      { value: "ts", label: t("iptvOutputTs") },
                      { value: "m3u8", label: t("iptvOutputHls") },
                    ]}
                    onChange={(output) => set("output", output)}
                  />
                </SettingsRow>
                <SettingsRow label={t("iptvIncludeVod")} hint={t("iptvIncludeVodHint")}>
                  <Toggle checked={form.includeVod} onChange={(v) => set("includeVod", v)} label={t("iptvIncludeVod")} />
                </SettingsRow>
              </div>
            ) : null}

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">{t("iptvEpgUrl")}</span>
              <input value={form.epgUrl} onChange={(e) => set("epgUrl", e.target.value)} placeholder="https://…/guide.xml.gz" className={field} spellCheck={false} />
              <span className="mt-1 block text-[12px] text-dim">{form.kind === "xtream" ? t("iptvEpgHintXtream") : t("iptvEpgHint")}</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">{t("iptvUserAgent")}</span>
              <input value={form.userAgent} onChange={(e) => set("userAgent", e.target.value)} placeholder="VLC/3.0.20 LibVLC/3.0.20" className={field} spellCheck={false} />
              <span className="mt-1 block text-[12px] text-dim">{t("iptvUserAgentHint")}</span>
            </label>
            {form.id ? (
              <SettingsRow label={t("iptvEnabled")} hint={t("iptvEnabledHint")}>
                <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} label={t("iptvEnabled")} />
              </SettingsRow>
            ) : null}

            {error ? (
              <p className="flex items-center gap-1.5 text-[13px] text-danger">
                <AlertCircle size={14} />
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                disabled={
                  busy ||
                  (form.kind === "m3uUrl" && !form.url.trim()) ||
                  (form.kind === "xtream" && (!form.url.trim() || !form.username.trim() || (!form.password && !form.id))) ||
                  (form.kind === "m3uFile" && form.fileText == null && !form.path.trim() && !form.fileName)
                }
                className={primary}
              >
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
                {t("save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(null);
                  setError("");
                  setAccount(null);
                }}
                className={tonal}
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("iptvPrefs")}>
        <SettingsRow label={t("iptvAutoRefresh")} hint={t("iptvAutoRefreshHint")}>
          <Toggle checked={prefs.autoRefresh} onChange={(autoRefresh) => void update({ iptv: { autoRefresh } })} label={t("iptvAutoRefresh")} />
        </SettingsRow>
        <SettingsRow label={t("iptvEpgEnabled")} hint={t("iptvEpgEnabledHint")}>
          <Toggle checked={prefs.epg} onChange={(epg) => void update({ iptv: { epg } })} label={t("iptvEpgEnabled")} />
        </SettingsRow>
        <SettingsRow label={t("iptvWheelZap")} hint={t("iptvWheelZapHint")}>
          <Toggle checked={prefs.wheelZap} onChange={(wheelZap) => void update({ iptv: { wheelZap } })} label={t("iptvWheelZap")} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
