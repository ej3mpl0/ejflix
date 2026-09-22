import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ToastStack } from "../components/ui/Toast";
import type { Toast, ToastAction } from "./types";

type ToastContextValue = {
  toast: (message: string, action?: ToastAction) => void;
  toasts: Toast[];
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_MS = 3200;

/** Transient messages stacked above the tab bar; each one leaves by itself after 3.2 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((item) => item.id !== id)), []);

  const toast = useCallback(
    (message: string, action?: ToastAction) => {
      const id = Date.now() * 10 + (counter.current++ % 10);
      setToasts((list) => [...list, { id, message, action }]);
      // A toast with an action stays long enough to reach it.
      setTimeout(() => dismiss(id), action ? 7000 : TOAST_MS);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ toast, toasts }), [toast, toasts]);

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.fill}>
        {children}
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast requires ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
