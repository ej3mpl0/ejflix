import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ToastStack } from "../components/ui/Toast";
import type { Toast } from "./types";

type ToastContextValue = {
  toast: (message: string) => void;
  toasts: Toast[];
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_MS = 3200;

/** Transient messages stacked above the tab bar; each one leaves by itself after 3.2 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const toast = useCallback((message: string) => {
    const id = Date.now() * 10 + (counter.current++ % 10);
    setToasts((list) => [...list, { id, message }]);
    setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id));
    }, TOAST_MS);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, toasts }), [toast, toasts]);

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.fill}>
        {children}
        <ToastStack toasts={toasts} />
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
