import { useRef, useState } from "react";
import { Camera, Check, LoaderCircle, Trash2 } from "lucide-react";
import type { LocalProfile } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { AVATAR_PRESETS, fileToAvatar, presetGradient, presetId } from "../lib/avatars";
import { useI18n } from "../lib/locale-context";
import { Avatar } from "./Avatar";
import { Toggle } from "./settings/Toggle";

/**
 * Create / edit a local profile: name, picture (preset gradient or an uploaded photo)
 * and an optional 4-digit PIN. Saves through the Rust commands and hands back the result.
 */
export function ProfileForm({
  initial = null,
  onSaved,
  onCancel,
  onDeleted,
  submitLabel,
}: {
  initial?: LocalProfile | null;
  /** `pin` is the PIN typed in this form (null when none / unchanged). */
  onSaved: (profile: LocalProfile, pin: string | null) => void;
  onCancel?: () => void;
  /** Present when the profile can be deleted from here. */
  onDeleted?: (profile: LocalProfile) => void;
  submitLabel?: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [avatar, setAvatar] = useState(initial?.avatar ?? presetId(0));
  const [usePin, setUsePin] = useState(initial?.hasPin ?? false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = initial != null;
  const keepsPin = editing && initial.hasPin && usePin && pin.length === 0;
  const pinValid = !usePin || keepsPin || /^\d{4}$/.test(pin);
  const canSave = name.trim().length > 0 && pinValid && !busy;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatar(await fileToAvatar(file));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      if (editing) {
        const patch: { name: string; avatar: string; pin?: string; clearPin?: boolean } = {
          name: name.trim(),
          avatar,
        };
        if (!usePin) patch.clearPin = true;
        else if (pin) patch.pin = pin;
        onSaved(await api.localProfileUpdate(initial.id, patch), usePin && pin ? pin : null);
      } else {
        onSaved(await api.localProfileCreate(name.trim(), avatar, usePin ? pin : null), usePin ? pin : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      await api.localProfileDelete(initial.id);
      onDeleted?.(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const field =
    "h-12 w-full rounded-btn border border-white/10 bg-black/40 px-4 text-[15px] text-text outline-none placeholder:text-dim focus:border-accent focus:ring-2 focus:ring-accent/30";

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-col items-center gap-3">
        <Avatar src={avatar} name={name || "?"} size={112} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="btn-press inline-flex h-9 items-center gap-2 rounded-pill bg-white/10 px-4 text-[13px] font-medium hover:bg-white/16"
        >
          <Camera size={15} />
          {t("uploadPhoto")}
        </button>
      </div>

      <p className="mt-6 mb-2 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{t("avatarLabel")}</p>
      <div className="grid grid-cols-6 gap-2.5" role="radiogroup" aria-label={t("avatarLabel")}>
        {AVATAR_PRESETS.map((_, i) => {
          const id = presetId(i);
          const active = avatar === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${t("avatarLabel")} ${i + 1}`}
              onClick={() => setAvatar(id)}
              className={cn(
                "btn-press relative grid aspect-square place-items-center rounded-full ring-2 ring-offset-2 ring-offset-base transition-[transform,box-shadow] duration-150 hover:scale-105",
                active ? "ring-white" : "ring-transparent",
              )}
              style={{ backgroundImage: presetGradient(id) ?? undefined }}
            >
              {active ? <Check size={18} className="text-white drop-shadow" /> : null}
            </button>
          );
        })}
      </div>

      <label className="mt-6 mb-2 block text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">
        {t("profileName")}
      </label>
      <input
        autoFocus
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("profileNamePlaceholder")}
        className={field}
      />

      <div className="mt-5 flex items-center justify-between gap-4 rounded-btn bg-white/4 px-4 py-3">
        <div>
          <p className="text-[14px] font-medium">{t("pinProtect")}</p>
          <p className="text-[12px] text-dim">{t("pinHint")}</p>
        </div>
        <Toggle checked={usePin} onChange={setUsePin} label={t("pinProtect")} />
      </div>
      {usePin ? (
        <div className="mt-3 flex items-center gap-3">
          <input
            value={pin}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            type="password"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder={keepsPin ? "••••" : t("pin")}
            aria-label={t("pin")}
            className={cn(field, "w-40 text-center text-[20px] tracking-[0.5em]")}
          />
          {keepsPin ? <span className="text-[13px] text-dim">{t("changePin")}</span> : null}
        </div>
      ) : null}

      {error ? <p className="mt-4 text-[13px] text-accent">{error}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSave}
          className="btn-press inline-flex h-12 items-center justify-center gap-2 rounded-btn bg-accent px-6 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
          {submitLabel ?? (editing ? t("save") : t("createProfile"))}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="btn-press inline-flex h-12 items-center rounded-btn bg-white/10 px-5 text-[14px] font-semibold hover:bg-white/16"
          >
            {t("cancel")}
          </button>
        ) : null}
        {editing && onDeleted ? (
          confirmDelete ? (
            <span className="ml-auto flex items-center gap-2 text-[13px] text-muted">
              <span className="max-w-[260px]">{t("deleteProfileConfirm", { name: initial.name })}</span>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="btn-press h-9 rounded-pill bg-accent px-4 text-[13px] font-semibold text-on-accent"
              >
                {t("delete")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto inline-flex h-10 items-center gap-2 rounded-pill px-3 text-[13px] text-dim hover:bg-white/8 hover:text-text"
            >
              <Trash2 size={15} />
              {t("deleteProfile")}
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
