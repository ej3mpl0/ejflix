import { Github, Heart } from "lucide-react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { Logo } from "../Logo";
import { UpdatesSection } from "./UpdatesSection";
import { SettingsSection } from "./SettingsSection";

const AUTHOR = "@j3mplo";
const AUTHOR_URL = "https://x.com/j3mplo";
const REPO_URL = "https://github.com/ej3mpl0/ejflix";

/** Settings › About: what this build is, who made it, and where it comes from. */
export function AboutSection({ version, withUpdates = true }: { version: string | null; withUpdates?: boolean }) {
  const { t } = useI18n();
  const link =
    "inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors duration-150 hover:text-text";

  return (
    <>
      <SettingsSection title={t("about")}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 py-4">
          <div className="scale-125 origin-left">
            <Logo />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-text tabular">
              {t("version")} {version ?? "—"}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[13px] text-dim">
              <Heart size={12} className="text-accent" />
              {t("madeBy")}
              <button
                type="button"
                onClick={() => void api.openExternal(AUTHOR_URL)}
                className="font-semibold text-accent hover:underline"
              >
                {AUTHOR}
              </button>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-5 py-3">
          <button type="button" onClick={() => void api.openExternal(AUTHOR_URL)} className={link}>
            <XLogo />
            {t("followOnX")}
          </button>
          <button type="button" onClick={() => void api.openExternal(REPO_URL)} className={link}>
            <Github size={14} />
            {t("sourceCode")}
          </button>
        </div>
      </SettingsSection>
      {withUpdates ? <UpdatesSection version={version} /> : null}
    </>
  );
}

/** X has no Lucide icon. */
function XLogo() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden>
      <path d="M18.9 2.3h3.4l-7.4 8.5 8.7 11.5h-6.8l-5.3-7-6.1 7H2l7.9-9.1L1.6 2.3h7l4.8 6.4zm-1.2 17.9h1.9L7.4 4.2H5.4z" />
    </svg>
  );
}
