import React from "react";
import { useI18n } from "../../lib/locale-context";
import { Sheet } from "../ui/Sheet";
import { LiveNavList, type LiveNavListProps } from "./LiveSidebar";

export type GroupsSheetProps = Omit<LiveNavListProps, "contentStyle"> & {
  visible: boolean;
  onClose: () => void;
};

/** The sidebar list as a bottom sheet — the phone way of picking a group. */
export function GroupsSheet({ visible, onClose, onSelect, ...list }: GroupsSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet visible={visible} onClose={onClose} title={t("iptvGroupsLabel")} snap={0.8}>
      <LiveNavList
        {...list}
        onSelect={(selection) => {
          onSelect(selection);
          onClose();
        }}
        contentStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
      />
    </Sheet>
  );
}
