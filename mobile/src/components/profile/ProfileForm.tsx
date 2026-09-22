import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { Camera, Check, Trash2 } from "lucide-react-native";
import type { LocalProfile } from "../../lib/types";
import { api } from "../../lib/api";
import { AVATAR_PRESETS, presetGradient, presetId } from "../../lib/avatars";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Avatar } from "../ui/Avatar";
import { Pill } from "../ui/Pill";
import { TextField } from "../ui/TextField";
import { Toggle } from "../ui/Toggle";

/** Largest picture stored in a profile (data URL, ≈ 400 KiB of JPEG). */
const MAX_AVATAR_BYTES = 400 * 1024;

/**
 * Create / edit a local profile: name, picture (preset gradient or a photo from
 * the gallery) and an optional 4-digit PIN. Saves through `api` and hands back the result.
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
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [avatar, setAvatar] = useState(initial?.avatar ?? presetId(0));
  const [usePin, setUsePin] = useState(initial?.hasPin ?? false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = initial != null;
  const keepsPin = editing && initial.hasPin && usePin && pin.length === 0;
  const pinValid = !usePin || keepsPin || /^\d{4}$/.test(pin);
  const canSave = name.trim().length > 0 && pinValid && !busy;

  const pickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) return;
      // No resizer on board (expo-image-manipulator is not installed): refuse oversized pictures.
      if (asset.base64.length * 0.75 > MAX_AVATAR_BYTES) {
        setError(tr("photoTooLarge"));
        return;
      }
      const mime = asset.mimeType && asset.mimeType.startsWith("image/") ? asset.mimeType : "image/jpeg";
      setAvatar(`data:${mime};base64,${asset.base64}`);
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
        const patch: { name: string; avatar: string; pin?: string; clearPin?: boolean } = { name: name.trim(), avatar };
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

  return (
    <View>
      <View style={{ alignItems: "center", gap: 12 }}>
        <Avatar src={avatar} name={name || "?"} size={112} />
        <Pill size="sm" pill icon={Camera} label={tr("choosePhoto")} onPress={() => void pickPhoto()} />
      </View>

      <Text style={s.sectionLabel}>{tr("avatarLabel")}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={tr("avatarLabel")} style={s.presets}>
        {AVATAR_PRESETS.map((_, i) => {
          const id = presetId(i);
          const active = avatar === id;
          const stops = presetGradient(id) ?? AVATAR_PRESETS[0];
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${tr("avatarLabel")} ${i + 1}`}
              onPress={() => setAvatar(id)}
              style={({ pressed }) => [s.presetCell, pressed ? { transform: [{ scale: 0.94 }] } : null]}
            >
              <View style={[s.presetRing, active ? { borderColor: "#ffffff" } : null]}>
                <LinearGradient colors={stops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.presetSwatch}>
                  {active ? <Check size={18} color="#ffffff" strokeWidth={2.6} /> : null}
                </LinearGradient>
              </View>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label={tr("profileName")}
        value={name}
        onChangeText={(v) => setName(v.slice(0, 40))}
        maxLength={40}
        placeholder={tr("profileNamePlaceholder")}
        autoCapitalize="words"
        autoFocus={!editing}
        returnKeyType="done"
        containerStyle={{ marginTop: 24 }}
      />

      <View style={s.pinRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.pinTitle}>{tr("pinProtect")}</Text>
          <Text style={s.pinHint}>{tr("pinHint")}</Text>
        </View>
        <Toggle checked={usePin} onChange={setUsePin} label={tr("pinProtect")} />
      </View>
      {usePin ? (
        <View style={s.pinField}>
          <TextField
            value={pin}
            onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            placeholder={keepsPin ? "••••" : tr("pin")}
            accessibilityLabel={tr("pin")}
            containerStyle={{ width: 160 }}
            inputStyle={{ ...text(20, "semibold"), textAlign: "center", letterSpacing: 10 }}
          />
          {keepsPin ? <Text style={s.changePin}>{tr("changePin")}</Text> : null}
        </View>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}

      <View style={s.actions}>
        <Pill variant="primary" size="lg" label={submitLabel ?? (editing ? tr("save") : tr("createProfile"))} loading={busy} disabled={!canSave} onPress={() => void save()} />
        {onCancel ? <Pill size="lg" label={tr("cancel")} onPress={onCancel} disabled={busy} /> : null}
      </View>

      {editing && onDeleted ? (
        confirmDelete ? (
          <View style={s.deleteRow}>
            <Text style={s.deleteText}>{tr("deleteProfileConfirm", { name: initial.name })}</Text>
            <Pill variant="primary" size="sm" pill label={tr("delete")} onPress={() => void remove()} disabled={busy} />
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={({ pressed }) => [s.deleteBtn, pressed ? { opacity: 0.6 } : null]}>
            <Trash2 size={15} color={t.colors.dim} strokeWidth={2} />
            <Text style={s.deleteLabel}>{tr("deleteProfile")}</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  sectionLabel: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, marginTop: 24, marginBottom: 10 },
  presets: { flexDirection: "row", flexWrap: "wrap" },
  presetCell: { width: `${100 / 6}%`, aspectRatio: 1, padding: 4 },
  presetRing: { flex: 1, borderRadius: 999, borderWidth: 2, borderColor: "transparent", padding: 2 },
  presetSwatch: { flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  pinRow: { marginTop: 20, flexDirection: "row", alignItems: "center", gap: 16, borderRadius: t.radii.btn, backgroundColor: t.white(0.04), paddingHorizontal: 16, paddingVertical: 10 },
  pinTitle: { ...text(14, "medium"), color: t.colors.text },
  pinHint: { ...text(12), color: t.colors.dim, marginTop: 2 },
  pinField: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  changePin: { ...text(13), color: t.colors.dim },
  error: { ...text(13), color: t.colors.accent, marginTop: 16 },
  actions: { marginTop: 24, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  deleteRow: { marginTop: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  deleteText: { ...text(13), color: t.colors.muted, flex: 1 },
  deleteBtn: { marginTop: 16, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 4 },
  deleteLabel: { ...text(13), color: t.colors.dim },
}));
