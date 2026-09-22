import type { NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { Movie } from "../lib/types";
import type { DetailsRoute } from "../lib/view-stack";

export type RootStackParamList = {
  Boot: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  Main: NavigatorScreenParams<MainStackParamList> | undefined;
};

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Profiles: undefined;
  Pin: { profileId: string };
  /** `from` = where "cancel" returns to. */
  ProfileEditor: { profileId?: string; from: "welcome" | "profiles" };
};

export type TabsParamList = {
  HomeTab: undefined;
  DiscoverTab: undefined;
  TvTab: undefined;
  SearchTab: undefined;
  SettingsTab: undefined;
};

export type MainStackParamList = {
  Tabs: NavigatorScreenParams<TabsParamList> | undefined;
  Details: { route: DetailsRoute };
  ExternalDetails: { seed: Movie };
  SettingsSection: { section: string };
  ProfileEditor: { profileId: string };
  Player: { movie: Movie };
  /** A row as a full grid; `catalog` lets an addon row keep paging. */
  SeeAll: { title: string; items: Movie[]; catalog?: { addonUrl: string; type: string; id: string } };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type MainScreenProps<T extends keyof MainStackParamList> = NativeStackScreenProps<MainStackParamList, T>;
export type TabScreenProps<T extends keyof TabsParamList> = BottomTabScreenProps<TabsParamList, T>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
