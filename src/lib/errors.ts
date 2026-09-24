import type { MessageKey } from "./i18n";
import { authErrorText } from "./account-errors";
import { isParentalBlocked, parentalErrorKey } from "./parental";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Rust's user-facing errors (`err:<code>` or `err:<code>:<detail>`, see `errors.rs`). */
const CODES: Record<string, MessageKey> = {
  invalidItem: "errInvalidItem",
  itemNotFound: "errItemNotFound",
  noSession: "errNoSession",
  noProfile: "errNoProfile",
  sessionExpired: "errSessionExpired",
  network: "errNetwork",
  jellyfinUnreachable: "errJellyfinUnreachable",
  unreachable: "errUnreachable",
  serverStatus: "errServerStatus",
  badReply: "errBadReply",
  profilesUnreadable: "errProfilesUnreadable",
  wrongCredentials: "errWrongCredentials",
  loginIncomplete: "errLoginIncomplete",
  invalidUrl: "errInvalidUrl",
  httpOnlyUrl: "errHttpOnlyUrl",
  urlCredentials: "errUrlCredentials",
  mpvMissing: "errMpvMissing",
  mpvStart: "errMpvStart",
  videoWindow: "errVideoWindow",
  channelNotFound: "errChannelNotFound",
  channelListGone: "errChannelListGone",
  channelUnavailable: "errChannelUnavailable",
  channelHttpOnly: "errChannelHttpOnly",
  invalidChannel: "errInvalidChannel",
  catchupUnsupported: "errCatchupUnsupported",
  catchupUnavailable: "errCatchupUnavailable",
  programmeStarted: "errProgrammeStarted",
  tooManyReminders: "errTooManyReminders",
  iptvMaxSources: "errIptvMaxSources",
  passwordTooLong: "errPasswordTooLong",
  m3uPick: "errM3uPick",
  fileNotFound: "errFileNotFound",
  xtreamLogin: "errXtreamLogin",
  fileTooLarge: "errFileTooLarge",
  notM3u: "errNotM3u",
  invalidList: "errInvalidList",
  missingServer: "errMissingServer",
  responseTooLarge: "errResponseTooLarge",
  downloadInterrupted: "errDownloadInterrupted",
  notXtream: "errNotXtream",
  m3uUnreadable: "errM3uUnreadable",
  noChannels: "errNoChannels",
  multiviewCount: "errMultiviewCount",
  multiviewConnections: "errMultiviewConnections",
  multiviewTooFew: "errMultiviewTooFew",
  multiviewNoAudio: "errMultiviewNoAudio",
  osNoApiKey: "errOsNoApiKey",
  osNothingToSearch: "errOsNothingToSearch",
  osRejected: "errOsRejected",
  osRateLimited: "errOsRateLimited",
  osMessage: "errOsMessage",
  osStatus: "errOsStatus",
  osUnreachable: "errOsUnreachable",
  osWrongCredentials: "errOsWrongCredentials",
  osNoSession: "errOsNoSession",
  osNoLink: "errOsNoLink",
  subDownloadFailed: "errSubDownloadFailed",
  subTooLarge: "errSubTooLarge",
  subFormat: "errSubFormat",
  traktStatus: "errTraktStatus",
  linkNotAllowed: "errLinkNotAllowed",
  listNameEmpty: "errListNameEmpty",
  tooManyLists: "errTooManyLists",
  listGone: "errListGone",
  listItemNoKey: "errListItemNoKey",
  listFull: "errListFull",
};

/**
 * Sentence to show for anything a Tauri command rejected with (a plain string) or a
 * thrown Error: Rust's `err:` codes, account (`auth:`), parental and Trakt errors are
 * translated; an unknown code still shows its detail; any other text is shown as is.
 */
export function errorText(t: Translate, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (message.startsWith("auth:")) return authErrorText(message, t);
  if (isParentalBlocked(message)) return t("parentalBlockedTitle");
  const pin = parentalErrorKey(message);
  if (pin) return t(pin);
  if (message === "trakt_bad_app") return t("traktBadApp");
  if (message === "trakt_expired" || message === "trakt_not_connected") return t("traktExpired");
  if (!message.startsWith("err:")) return message || t("errGeneric");
  const rest = message.slice(4);
  const split = rest.indexOf(":");
  const code = split < 0 ? rest : rest.slice(0, split);
  const detail = split < 0 ? "" : rest.slice(split + 1);
  const key = CODES[code];
  if (key) return t(key, { detail });
  return detail ? t("errGenericDetail", { detail }) : t("errGeneric");
}
