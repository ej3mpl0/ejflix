import { Linking, Platform } from "react-native";

/**
 * iOS players that take a stream URL through a link, in order of preference. They
 * have to be listed in `LSApplicationQueriesSchemes` (app.json) for `canOpenURL`.
 */
const IOS_PLAYERS: ((url: string) => string)[] = [
  (url) => `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}`,
  (url) => `infuse://x-callback-url/play?url=${encodeURIComponent(url)}`,
  (url) => `outplayer://${url}`,
];

/**
 * Hands a stream the built-in player cannot decode to another app. Android lets the
 * user pick one from the plain URL (VLC, mpv-android…); on iOS the first installed
 * player from `IOS_PLAYERS` is opened, else Safari gets the URL.
 */
export async function openInExternalPlayer(url: string): Promise<void> {
  if (Platform.OS === "ios") {
    for (const build of IOS_PLAYERS) {
      const link = build(url);
      if (await Linking.canOpenURL(link).catch(() => false)) {
        await Linking.openURL(link);
        return;
      }
    }
  }
  await Linking.openURL(url);
}
