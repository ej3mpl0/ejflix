import type { MessageKey } from "./i18n";

/** Rust reports account problems as `auth:<code>` (Supabase codes plus a few of ours). */
const CODES: Record<string, MessageKey> = {
  invalid_credentials: "authErrInvalidCredentials",
  invalid_grant: "authErrInvalidCredentials",
  email_not_confirmed: "authErrEmailNotConfirmed",
  user_already_exists: "authErrUserExists",
  email_exists: "authErrUserExists",
  weak_password: "authErrWeakPassword",
  validation_failed: "authErrValidation",
  mfa_verification_failed: "authErrMfa",
  mfa_challenge_expired: "authErrMfa",
  mfa_not_enrolled: "authErrMfa",
  offline: "authErrOffline",
  timeout: "authErrTimeout",
  session_expired: "authErrSessionExpired",
  not_signed_in: "authErrNotSignedIn",
  password_mismatch: "authErrPasswordMismatch",
  signup_disabled: "authErrSignupClosed",
  email_provider_disabled: "authErrSignupClosed",
  mfa_required: "accountSyncSkippedMfa",
  doc_too_large: "authErrDocTooLarge",
};

export function authErrorText(
  err: unknown,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (message.startsWith("auth:")) {
    const code = message.slice(5);
    const key = CODES[code] ?? (code.startsWith("over_") ? "authErrRate" : "authErrGeneric");
    return t(key);
  }
  return message || t("authErrGeneric");
}
