import { useState } from "react";
import { Check, ClipboardPaste, Download, LoaderCircle, LogIn } from "lucide-react";
import type { ImportedAddon } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../lib/errors";
import { useSettings } from "../lib/settings-context";
import { fieldClass, labelClass } from "../lib/ui";
import { Pill } from "./Pill";
import { SegmentedControl } from "./settings/SegmentedControl";

type Source = "stremio" | "paste";

/** Manifest URLs found in free text: one per line, or several mixed with other words. */
function urlsIn(text: string): string[] {
  const found = text.match(/(?:https?|stremio):\/\/[^\s"'<>,]+/gi) ?? [];
  return [...new Set(found.map((url) => url.replace(/[).;]+$/, "")))];
}

/**
 * Brings addons from another app: a Stremio account (its addon collection is read through
 * Stremio's API; the password is never stored) or a pasted list of manifest URLs, which is
 * what Nuvio, Omni and most other Stremio-compatible apps can export or show.
 */
export function AddonImport({ onImported }: { onImported?: (added: number) => void }) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const [source, setSource] = useState<Source>("stremio");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [found, setFound] = useState<ImportedAddon[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ added: number; failed: string[] } | null>(null);
  const installed = new Set(settings.addons.urls);

  const fetchStremio = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const list = await api.stremioAddons(email, password);
      setFound(list);
      setPassword("");
      // Pre-select what the person installed themselves and does not have here yet.
      setPicked(new Set(list.filter((a) => !a.official && !installed.has(a.url)).map((a) => a.url)));
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      setError(
        code === "stremio_auth"
          ? t("stremioErrAuth")
          : code === "stremio_network"
            ? t("stremioErrNetwork")
            : code === "stremio_unexpected"
              ? t("stremioErrUnexpected")
              : errorText(t, code),
      );
    } finally {
      setBusy(false);
    }
  };

  const install = async (urls: string[]) => {
    setBusy(true);
    setError("");
    let added = 0;
    const failed: string[] = [];
    // One after another: each one is validated (manifest fetched) before it is saved.
    for (const url of urls) {
      try {
        await api.addonAdd(url);
        added += 1;
      } catch {
        failed.push(url);
      }
    }
    setBusy(false);
    setResult({ added, failed });
    if (added) onImported?.(added);
  };

  const pastedUrls = urlsIn(pasted);
  const selected = found?.filter((addon) => picked.has(addon.url)) ?? [];

  return (
    <div className="space-y-4">
      <SegmentedControl<Source>
        label={t("importFrom")}
        value={source}
        onChange={(next) => {
          setSource(next);
          setError("");
          setResult(null);
        }}
        options={[
          { value: "stremio", label: "Stremio" },
          { value: "paste", label: t("importPaste") },
        ]}
      />

      {source === "stremio" ? (
        found ? (
          <div>
            {found.length ? (
              <ul className="max-h-[260px] space-y-1 overflow-y-auto rounded-btn bg-black/25 p-1.5">
                {found.map((addon) => {
                  const have = installed.has(addon.url);
                  const on = picked.has(addon.url);
                  return (
                    <li key={addon.url}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-white/5",
                          have && "cursor-default opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--color-accent)]"
                          checked={have || on}
                          disabled={have || busy}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(addon.url);
                            else next.delete(addon.url);
                            setPicked(next);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">{addon.name}</span>
                          <span className="block truncate text-[11px] text-dim">
                            {have ? t("importAlready") : addon.official ? t("importOfficial") : addon.url}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-dim">{t("importNoneFound")}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill
                variant="primary"
                disabled={busy || !selected.length}
                icon={busy ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
                onClick={() => void install(selected.map((a) => a.url))}
              >
                {t("importSelected", { n: selected.length })}
              </Pill>
              <Pill variant="ghost" disabled={busy} onClick={() => setFound(null)}>
                {t("importOtherAccount")}
              </Pill>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void fetchStremio();
            }}
          >
            <label className="block">
              <span className={labelClass}>{t("importStremioEmail")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>{t("password")}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={fieldClass}
              />
            </label>
            <p className="text-[12px] leading-[1.5] text-dim">{t("importStremioPrivacy")}</p>
            <Pill
              type="submit"
              variant="primary"
              disabled={busy || !email.trim() || !password}
              icon={busy ? <LoaderCircle size={16} className="animate-spin" /> : <LogIn size={16} />}
            >
              {t("importReadAddons")}
            </Pill>
          </form>
        )
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>{t("importPasteLabel")}</span>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={"https://…/manifest.json\nhttps://…/manifest.json"}
              className={cn(fieldClass, "h-auto resize-y py-2.5 font-mono text-[12px] leading-[1.6]")}
            />
          </label>
          <p className="text-[12px] leading-[1.5] text-dim">{t("importPasteHint")}</p>
          <Pill
            variant="primary"
            disabled={busy || !pastedUrls.length}
            icon={busy ? <LoaderCircle size={16} className="animate-spin" /> : <ClipboardPaste size={16} />}
            onClick={() => void install(pastedUrls.filter((url) => !installed.has(url)))}
          >
            {t("importSelected", { n: pastedUrls.length })}
          </Pill>
        </div>
      )}

      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      {result ? (
        <p role="status" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          {result.added ? <Check size={14} className="text-success" /> : null}
          {result.added === 1 ? t("importResultOne") : t("importResult", { n: result.added })}
          {result.failed.length ? (
            <span className="text-danger">· {result.failed.length === 1 ? t("importFailedOne") : t("importFailed", { n: result.failed.length })}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
