import React from "react";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { LogOut, Settings as SettingsIcon, Users } from "lucide-react-native";
import { sessionAvatar } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useSession } from "../../lib/session-context";
import type { TabsParamList } from "../../navigation/types";
import { Avatar } from "../ui/Avatar";
import { ActionSheet, type SheetAction } from "../ui/ActionSheet";

/**
 * Account menu behind the header avatar (desktop `GlassHeader` dropdown): settings,
 * back to "who is watching" and — for Jellyfin users — forgetting the server.
 */
export function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { session, switchProfile, logoutServer } = useSession();
  const navigation = useNavigation<BottomTabNavigationProp<TabsParamList>>();

  const actions: SheetAction[] = [
    {
      key: "settings",
      label: t("settings"),
      icon: SettingsIcon,
      onPress: () => navigation.navigate("SettingsTab"),
    },
    {
      key: "switch",
      label: t("switchProfile"),
      icon: Users,
      onPress: () => void switchProfile(),
    },
  ];
  if (session?.mode === "jellyfin") {
    actions.push({
      key: "signout",
      label: t("signOut"),
      icon: LogOut,
      destructive: true,
      onPress: () => void logoutServer(),
    });
  }

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={session?.userName}
      subtitle={session?.serverName ?? session?.jellyfinUserName ?? undefined}
      thumb={session ? <Avatar src={sessionAvatar(session)} name={session.userName} size={48} /> : null}
      actions={actions}
    />
  );
}
