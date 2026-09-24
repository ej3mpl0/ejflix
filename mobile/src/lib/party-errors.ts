import type { MessageKey } from "./i18n";

/** Message key for a watch party error code (`party:*`). */
export function partyErrorKey(error: string | null | undefined): MessageKey {
  switch (error) {
    case "party:bad_code":
      return "partyErrBadCode";
    case "party:not_found":
      return "partyErrNotFound";
    case "party:host_ended":
      return "partyErrHostEnded";
    case "party:host_left":
      return "partyErrHostLeft";
    case "party:needs_account":
      return "partyErrNeedsAccount";
    case "party:denied":
      return "partyErrDenied";
    case "party:offline":
      return "partyErrOffline";
    default:
      return "partyErrGeneric";
  }
}
