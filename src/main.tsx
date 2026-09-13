import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { OverlayApp } from "./screens/OverlayApp";
import { I18nProvider } from "./lib/locale-context";
import { SettingsProvider } from "./lib/settings-context";
import { applyTheme, readCachedTheme } from "./lib/theme";
import "./index.css";

// Theme before the first paint (both windows); Rust settings take over right after.
applyTheme(readCachedTheme());

const overlay = getCurrentWindow().label === "player-overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      {overlay ? (
        <SettingsProvider userId={null}>
          <OverlayApp />
        </SettingsProvider>
      ) : (
        <App />
      )}
    </I18nProvider>
  </React.StrictMode>,
);
