import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { OverlayApp } from "./screens/OverlayApp";
import { I18nProvider } from "./lib/locale-context";
import "./index.css";

const overlay = getCurrentWindow().label === "player-overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>{overlay ? <OverlayApp /> : <App />}</I18nProvider>
  </React.StrictMode>,
);
