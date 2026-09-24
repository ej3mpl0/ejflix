import * as Haptics from "expo-haptics";

/**
 * App-wide haptic feedback behind the "Haptics" setting. The settings provider keeps
 * `enabled` in sync, so callers outside React (gesture callbacks) need no context.
 */
let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export type HapticKind = "light" | "medium" | "heavy" | "selection" | "success" | "warning";

export function haptic(kind: HapticKind = "light"): void {
  if (!enabled) return;
  let run: Promise<void>;
  switch (kind) {
    case "selection":
      run = Haptics.selectionAsync();
      break;
    case "success":
      run = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case "warning":
      run = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case "heavy":
      run = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      break;
    case "medium":
      run = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    default:
      run = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  // Devices without a vibrator reject; feedback is never worth an error.
  void run.catch(() => undefined);
}
