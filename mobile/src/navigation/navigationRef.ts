import { createNavigationContainerRef } from "@react-navigation/native";
import type { Movie } from "../lib/types";
import { routeFor } from "../lib/view-stack";
import type { RootStackParamList } from "./types";

/** Imperative navigation from outside React (player events, toasts, deep links). */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Opens the details page of any item (episodes open their series). */
export function openDetails(movie: Movie) {
  if (!navigationRef.isReady()) return;
  if (movie.external) {
    navigationRef.navigate("Main", { screen: "ExternalDetails", params: { seed: movie } });
    return;
  }
  navigationRef.navigate("Main", { screen: "Details", params: { route: routeFor(movie) } });
}

/** Opens the full-screen player for the given item. */
export function openPlayer(movie: Movie) {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate("Main", { screen: "Player", params: { movie } });
}

export function goBack() {
  if (navigationRef.isReady() && navigationRef.canGoBack()) navigationRef.goBack();
}
